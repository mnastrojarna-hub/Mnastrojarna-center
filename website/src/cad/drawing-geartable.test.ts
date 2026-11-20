/** Tabulka ozubení na výkrese (vlna 19, balík text): řádky na listu, výška pásu, kreslení, varování, stav, text výkresu. */
import { describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import type { DText, Poly } from "./drawing";
import { drawGearTables, GEAR_ROW, GEAR_TABLE_W, gearSheetRows, gearTableHeight, gearTableStatus, gearTableWidth } from "./drawing-geartable";
import { gearTablesOf, KINDS } from "./gears";
import { emptyDoc, type Feature } from "./types";

const wheel = (id: string, name: string, ext: string, data: Record<string, unknown>) => ({ id, name, type: "ext", ext, data: { ...KINDS[ext.slice(5) as "spur"].defaults(), ...data } }) as unknown as Feature;
const doc = (...f: Feature[]) => ({ ...emptyDoc("Kola"), features: f });

describe("řádky tabulky ozubení na listu", () => {
  it("čelní kolo: k a D_M připsané k W a M, bez rozteče; hodnoty s jednotkou", () => {
    const [t] = gearTablesOf(doc(wheel("a", "Ozubené kolo m2 z24", "gear.spur", { m: 2, z: 24, mateZ: 60, aw: 81 })));
    const rows = gearSheetRows(t);
    const by = (s: string) => rows.find((r) => r.symbol === s)!;
    expect(by("mₙ").value).toBe("2 mm");
    expect(by("αₙ").value).toBe("20,00°");
    expect(by("W3")).toMatchObject({ label: "Rozměr přes zuby (k = 3)", value: "15,433 mm" });
    expect(by("M_dK")).toMatchObject({ label: "Rozměr přes kuličky (D_M 3,500 mm)", value: "52,951 mm" });
    expect(by("a_w").value).toBe("81,000 mm");
    expect(rows.some((r) => r.symbol === "p" || r.symbol === "k" || r.symbol === "D_M")).toBe(false);
    expect(rows.find((r) => r.label === "Základní profil")!.value).toBe("ISO 53-A");
  });
  it("šikmé kolo: smysl stoupání u úhlu sklonu; řetězové kolo: řádky ISO 606", () => {
    const [h, s] = gearTablesOf(doc(wheel("a", "H", "gear.helical", { beta: 15, hand: "left" }), wheel("b", "S", "gear.sprocket", { chain: "08B", z: 19 })));
    expect(gearSheetRows(h).find((r) => r.symbol === "β")!.value).toBe("15,000° levý");
    expect(gearSheetRows(h).some((r) => r.label === "Smysl stoupání")).toBe(false);
    const sr = gearSheetRows(s);
    expect(sr.find((r) => r.symbol === "d")!.value).toBe("77,159 mm");
    expect(sr.find((r) => r.symbol === "M_R")!.value).toBe("85,406 mm");
  });
});

describe("výška, šířka a kreslení", () => {
  const tables = gearTablesOf(doc(wheel("a", "Kolo 1", "gear.spur", {}), wheel("b", "Kolo 2", "gear.sprocket", {}), wheel("c", "Kolo 3", "gear.ratchet", {})));
  it("výška = nejvyšší ze dvou kreslených tabulek + 4 mm, šířka 110 mm na tabulku, třetí se nekreslí", () => {
    const n1 = gearSheetRows(tables[0]).length + 1;
    expect(gearTableHeight([])).toBe(0);
    expect(gearTableHeight(tables.slice(0, 1))).toBeCloseTo(n1 * GEAR_ROW + 4, 9);
    expect(gearTableHeight(tables)).toBeCloseTo(Math.max(n1, gearSheetRows(tables[1]).length + 1) * GEAR_ROW + 4, 9);
    expect(gearTableWidth(tables)).toBe(2 * GEAR_TABLE_W);
  });
  it("kreslí rámečky a texty vpravo zarovnané, druhou tabulku vlevo; tři kola = varování", () => {
    const polys: Poly[] = [];
    const texts: DText[] = [];
    const r = drawGearTables(410, 250, tables, polys, texts);
    expect(r.w).toBe(220);
    expect(r.x).toBe(190);
    expect(r.y + r.h).toBeCloseTo(246, 9);
    expect(r.warnings[0]).toMatch(/v dílu je 3 kol, na list se vejdou tabulky prvních 2/);
    expect(texts.some((t) => t.s === "Tabulka ozubení – Kolo 1")).toBe(true);
    expect(texts.some((t) => t.s === "Tabulka ozubení – Kolo 2")).toBe(true);
    expect(texts.some((t) => t.s.includes("Kolo 3"))).toBe(false);
    expect(texts.some((t) => t.s === "15,433 mm" && t.anchor === "end")).toBe(true);
    // všechny čáry uvnitř pásu
    for (const p of polys) for (const [x, y] of p.pts) {
      expect(x).toBeGreaterThanOrEqual(190 - 1e-9);
      expect(x).toBeLessThanOrEqual(410 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(r.y - 1e-9);
      expect(y).toBeLessThanOrEqual(r.y + r.h + 1e-9);
    }
    // první tabulka vpravo
    const t1 = texts.find((t) => t.s === "Tabulka ozubení – Kolo 1")!;
    expect(t1.x).toBeGreaterThan(300);
  });
  it("stav výkresu: jeden řádek na kolo se značkami a hodnotami", () => {
    const st = gearTableStatus(tables);
    expect(st).toHaveLength(2);
    expect(st[0]).toMatch(/^Tabulka ozubení: Kolo 1 – mₙ 2 mm, z 24, αₙ 20,00°/);
  });
});

describe("text výkresu: tabulka ozubení ano|ne (CS / EN / DE)", () => {
  const opts = (t: string) => {
    const p = parseAgentText(t);
    expect(p.errors, t).toEqual([]);
    const op = p.ops[0];
    return op?.k === "drawingCmd" && op.cmd.k === "set" ? op.cmd.opts : null;
  };
  it("výkres tabulka ozubení ano · drawing gear table yes · zeichnung verzahnungstabelle ja · tabulka děr dál funguje", () => {
    expect(opts("výkres tabulka ozubení ano")).toMatchObject({ gearTable: true });
    expect(opts("výkres A3 tabulka ozubení ne")).toMatchObject({ gearTable: false, sheet: "A3" });
    expect(opts("drawing gear table yes")).toMatchObject({ gearTable: true });
    expect(opts("drawing geartable no")).toMatchObject({ gearTable: false });
    expect(opts("zeichnung verzahnungstabelle ja")).toMatchObject({ gearTable: true });
    expect(opts("výkres tabulka děr ano tabulka ozubení ano")).toMatchObject({ holeTable: true, gearTable: true });
    expect(opts("výkres tabulka ano")).toMatchObject({ holeTable: true });
    expect(opts("výkres tabulka ozubení ano")!.holeTable).toBeUndefined();
  });
});

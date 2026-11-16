/**
 * Integrace vlny 21 (pružiny z tabulky + pružiny v pohybu na enginu fáze B):
 * - výkres: tlačná pružina z tabulky (`spring.compression`) se kreslí zjednodušeně podle ISO 2162-1 jako ostatní pružiny – obal
 *   vinutí přesně mezi koncovými rovinami 0 a L (L0, nebo délka tvaru `len`), Ø De / Di z výpočtu; tabulka údajů pružiny dál
 *   z původního dokumentu (meta `springData`, ne `springs` = osy drátu ISO 2162-1);
 * - strojový řádek pohybové studie nese výsledek dynamiky (`mode=dyn … spring.max=… return=…`), souhrn studie předá i řádky kolizí.
 * Ruční hodnoty: d 2 · De 20 · L0 50 · n 8, broušené: D = 18, Di 16, nt = 10 → obal Ø20 / Ø16, 0 … 50 (v délce tvaru 30: 0 … 30).
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { buildShape } from "./build";
import { drawingDoc, drawnSpringIndices, isSpringEnvelope, springMarksOf } from "./drawing-doc";
import { springDrawTables } from "./drawing-springtable";
import { motionKv } from "./asm-agent-kin";
import { studySummary } from "./motion-dynamic-report";
import type { DynResult } from "./motion-dynamic";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

const table = (data: Record<string, unknown> = {}): Feature => ({ id: "t1", name: "Tlačná pružina 1", type: "ext", ext: "spring.compression", data: { d: 2, De: 20, L0: 50, n: 8, ends: "ground", material: "SH", at: [0, 0, 0], axis: "Z", mode: "new", ...data } });
const part = (features: Feature[]): CadDoc => ({ ...emptyDoc("Pružina"), features });

describe("výkres: tlačná pružina z tabulky zjednodušeně (ISO 2162-1)", () => {
  it("drawnSpringIndices / drawingDoc: obal místo vinutí; osa odkazem, odebrání nebo pružina přidaná na těleso zůstanou plné", () => {
    const doc = part([table()]);
    expect([...drawnSpringIndices(doc)]).toEqual([0]);
    const dd = drawingDoc(doc);
    expect(dd.features[0].type).toBe("spring");
    expect(isSpringEnvelope(dd.features[0])).toBe(true);
    // tabulka údajů pružiny z původního dokumentu (v kopii pro výkres je obal)
    expect(springDrawTables(doc)).toHaveLength(1);
    expect(springDrawTables(dd)).toHaveLength(0);
    expect(drawnSpringIndices(part([table({ atRef: { kind: "vertex", index: 1 } })])).size).toBe(0);
    expect(drawnSpringIndices(part([table({ mode: "cut" })])).size).toBe(0);
    const onBody: Feature = { id: "b", name: "Kvádr", type: "box", size: [40, 40, 10], position: [0, 0, 0], centered: false, mode: "new" } as Feature;
    expect(drawnSpringIndices(part([onBody, table({ mode: "add" })])).size).toBe(0);
    expect(drawingDoc(part([table()]), "full").features[0].type).toBe("ext");
  });

  it("obal v jádře: Ø20 / Ø16 přesně mezi 0 a L0, v délce tvaru 30 mezi 0 a 30, osa X z bodu [5, 0, 0]; osy drátu na D = 18", { timeout: 120_000 }, async () => {
    for (const [data, lo, hi, len] of [
      [{}, [-10, -10, 0], [10, 10, 50], 50],
      [{ len: 30 }, [-10, -10, 0], [10, 10, 30], 30],
      [{ axis: "X", at: [5, 0, 0] }, [5, -10, -10], [55, 10, 10], 50],
    ] as const) {
      const dd = drawingDoc(part([table(data)]));
      const res = await buildShape(dd);
      expect(res.body).toBeTruthy();
      const b = res.body!.boundingBox.bounds as [[number, number, number], [number, number, number]];
      for (let k = 0; k < 3; k++) {
        expect(b[0][k]).toBeCloseTo(lo[k], 2);
        expect(b[1][k]).toBeCloseTo(hi[k], 2);
      }
      const marks = springMarksOf(dd);
      expect(marks).toHaveLength(1);
      expect(marks[0].r).toBeCloseTo(9, 9);
      expect(marks[0].ro).toBeCloseTo(10, 9);
      expect(marks[0].ri).toBeCloseTo(8, 9);
      expect(marks[0].len).toBeCloseTo(len, 6);
    }
  });
});

describe("pohybová studie: strojový řádek a souhrn dynamiky", () => {
  const base = { motors: [], comps: [], steps: [{ i: 0, t: 0, motors: [], place: {}, conflicts: [] }], conflictSteps: 0 } as unknown as DynResult;
  it("motion … mode=dyn bodies spring.max return drift", () => {
    const res = {
      ...base,
      dynamic: {
        bodies: [{ id: "S", name: "Stírací deska", mass: 2.4, source: "manual" }],
        springMax: { id: "P", force: 85.93, t: 0.2385 },
        contacts: [
          { label: "Doraz", bound: "max", limit: 25, unit: "mm", intervals: [[0, 0.125], [0.375, 0.5]], impacts: [] },
          { label: "Matrice", bound: "min", limit: 0, unit: "mm", intervals: [[0.125, 0.375]], impacts: [] },
        ],
        energy: { e0: 0.3, end: 0.3, drift: 0.0001, damping: 0, contacts: 0, applied: 0, kinMax: 1 },
      },
    } as unknown as DynResult;
    expect(motionKv(res, null)).toMatch(/^motion steps=0 t=0 motors=0 conflicts=0 static=0 mode=dyn bodies=1 spring\.max=85\.9N@0\.2385s stops=2 return=0\.375s drift=0\.01%$/);
    // kinematika beze změny (bez mode=dyn)
    expect(motionKv(base, null)).not.toMatch(/mode=dyn/);
  });
  it("studySummary předá řádky kolizí do souhrnu kinematiky (dřív je dynamický souhrn zahodil)", () => {
    const doc = { ...emptyDoc("S"), kind: "assembly" as const, components: [] };
    expect(studySummary({ ...base, collisionsChecked: true } as DynResult, doc, { collisionLines: ["KOLIZE X"] }).join("\n")).toMatch(/KOLIZE X/);
  });
});

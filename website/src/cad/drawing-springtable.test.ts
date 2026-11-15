/**
 * Tabulka údajů pružiny na výkrese (EN ISO 2162-2): řádky podle druhu, kreslení nad razítkem (místo pro pohledy se zmenší),
 * textová volba `výkres tabulka pružiny ano` (CS / EN / DE) a převodník dokument → skript.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText, type AgentOp } from "./agent";
import { makeDrawing, type DrawingMeta } from "./drawing";
import { springDrawTables, springTableHeight } from "./drawing-springtable";
import { docToScript } from "./doc-script";
import { NEW_DRAWING_OPTIONS } from "./drawing-agent";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

const feats = (text: string): Feature[] => (parseAgentText(text).ops as AgentOp[]).filter((o): o is Extract<AgentOp, { k: "feature" }> => o.k === "feature").map((o) => o.feature);

describe("tabulka údajů pružiny", () => {
  const doc: CadDoc = { ...emptyDoc("Pružina"), features: feats("pružina tlačná d 2 De 20 L0 50 n 8 L1 40 L2 30 název \"P1\"") };
  it("řádky EN ISO 2162-2 tlačné pružiny", () => {
    const t = springDrawTables(doc);
    expect(t).toHaveLength(1);
    expect(t[0].title).toBe("Údaje pružiny „P1“ (EN ISO 2162-2)");
    const m = Object.fromEntries(t[0].rows);
    expect(m.d).toBe("2 mm");
    expect(m["D / De"]).toBe("18 / 20 mm");
    expect(m.L0).toBe("50 mm");
    expect(m["n / nt"]).toBe("8 / 10");
    expect(m.R).toBe("3,494 N/mm");
    expect(m["F1 / L1"]).toBe("34,9 N / 40 mm");
    expect(m["F2 / L2"]).toBe("69,9 N / 30 mm");
    expect(m.Ln).toBe("20 mm");
    expect(m.konce).toBe("přiložené a broušené");
    expect(springTableHeight(t)).toBeGreaterThan(30);
    // ostatní druhy mají své řádky
    const other: CadDoc = { ...emptyDoc("X"), features: feats("pružina tažná d 1,6 De 12 n 12 F0 5\npružina zkrutná d 2 De 20 n 6,25 a2 60\npružina talířová řada A De 40 sloupec 4 1") };
    const ot = springDrawTables(other);
    expect(ot.map((x) => x.rows.length)).toEqual([10, 9, 7]);
  });
  it("na listu nad razítkem; bez volby se nekreslí", async () => {
    // tabulka nezávisí na tělese – kvádr místo pružiny (skryté hrany šroubovice na 5 pohledech trvají desítky sekund)
    const body = r.makeBaseBox(20, 20, 50) as r.Shape3D;
    const meta: DrawingMeta = { name: "Pružina", material: "ocel", springData: springDrawTables(doc) };
    const on = makeDrawing(body, meta, { springTable: true, dimensions: "none" });
    expect(on.springTables).toBe(1);
    expect(on.texts.some((t) => t.s === "Údaje pružiny „P1“ (EN ISO 2162-2)")).toBe(true);
    expect(on.texts.some((t) => t.s === "3,494 N/mm")).toBe(true);
    // patička razítka („Rozměry v mm“, „List 1/1“) leží nad tabulkou, ne přes její spodní řádek (nález 3)
    const title = on.texts.find((t) => t.s === "Údaje pružiny „P1“ (EN ISO 2162-2)")!;
    const top = title.y - 3.2; // horní hrana tabulky (titulek 1,4 mm nad spodní čarou prvního řádku 4,6 mm)
    const bottom = top + springTableHeight(meta.springData) - 3;
    const footer = on.texts.filter((t) => /Rozměry v mm|List 1\/1/.test(t.s));
    expect(footer.length).toBeGreaterThan(0);
    for (const f of footer) expect(f.y <= top - 0.5 || f.y - (f.size ?? 2.5) >= bottom + 0.5, `„${f.s}“ y ${f.y} × tabulka ${top}…${bottom}`).toBe(true);
    // a s tabulkou děr pod ní – patička nad oběma tabulkami
    const holes = makeDrawing(r.makeBaseBox(60, 40, 10).cut(r.makeCylinder(4, 20, [10, 10, -5]) as never) as r.Shape3D, meta, { springTable: true, holeTable: true, dimensions: "none" });
    const t2 = holes.texts.find((t) => t.s === "Údaje pružiny „P1“ (EN ISO 2162-2)")!;
    for (const f of holes.texts.filter((t) => /Rozměry v mm|List 1\/1/.test(t.s))) expect(f.y, f.s).toBeLessThanOrEqual(t2.y - 3.2 - 0.5);
    const off = makeDrawing(body, meta, { dimensions: "none" });
    expect(off.springTables).toBeUndefined();
    expect(off.texts.some((t) => /Údaje pružiny/.test(t.s))).toBe(false);
  }, 60_000);
  it("text výkres tabulka pružiny ano (CS / EN / DE) a skript dokumentu", () => {
    for (const line of ["výkres tabulka pružiny ano", "drawing springtable yes", "zeichnung federtabelle ja"]) {
      const p = parseAgentText(line);
      expect(p.errors.map((e) => e.message), line).toEqual([]);
      const op = p.ops[0] as Extract<AgentOp, { k: "drawingCmd" }>;
      expect(JSON.stringify(op.cmd), line).toMatch(/"springTable":true/);
    }
    const withSheet: CadDoc = { ...doc, drawings: [{ id: "d1", name: "List 1", options: { ...NEW_DRAWING_OPTIONS, springTable: true } } as never] };
    const s = docToScript(withSheet, { lang: "cs" }).text;
    expect(s).toMatch(/výkres .*tabulka pružiny ano/);
  });
});

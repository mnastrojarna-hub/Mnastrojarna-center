import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { makeDrawing } from "./drawing";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

/** deska 80×50×20 s dírou Ø20 a dvěma otvory Ø5 (jádro M6) */
const plate = () => {
  let s = r.makeBox([-40, -25, 0], [40, 25, 20]) as r.Shape3D;
  s = s.cut(r.makeCylinder(10, 40, [0, 0, -10], [0, 0, 1]));
  for (const x of [-30, 30]) s = s.cut(r.makeCylinder(2.5, 40, [x, 0, -10], [0, 0, 1]));
  return s;
};
const dimTexts = (d: ReturnType<typeof makeDrawing>) => d.texts.filter((t) => t.layer === "dim").map((t) => t.s);

describe("výrobní požadavky jen na vyžádání", () => {
  it("bez zadání se na výkrese neobjeví ISO 2768 ani sražení hran – jen „Rozměry v mm“", () => {
    const d = makeDrawing(plate(), { name: "Deska", material: "ČSN 11 423" });
    const all = d.texts.map((t) => t.s).join("\n");
    expect(all).not.toMatch(/2768/);
    expect(all).not.toMatch(/0,5×45/);
    expect(all).toContain("Rozměry v mm");
    expect(all).toContain("ČSN 11 423");
  });
  it("tolerance a hrany se uvedou jen zadané, každá zvlášť", () => {
    const d1 = makeDrawing(plate(), { name: "Deska", material: "Ocel", tolerance: "ISO 2768-mK" });
    expect(d1.texts.map((t) => t.s).join("\n")).toMatch(/Nepředepsané tolerance ISO 2768-mK/);
    expect(d1.texts.map((t) => t.s).join("\n")).not.toMatch(/Hrany/);
    const d2 = makeDrawing(plate(), { name: "Deska", material: "Ocel", edges: "srazit 0,5×45°" });
    const all2 = d2.texts.map((t) => t.s).join("\n");
    expect(all2).toMatch(/Hrany: srazit 0,5×45°/);
    expect(all2).not.toMatch(/2768/);
  });
});

describe("závitové díry na výkrese", () => {
  it("místo Ø jádra se kótuje označení závitu s počtem a hloubkou", () => {
    const plain = makeDrawing(plate(), { name: "Deska", material: "Ocel" });
    expect(dimTexts(plain)).toContain("2× Ø5");
    const d = makeDrawing(plate(), { name: "Deska", material: "Ocel", threads: [{ r: 2.5, label: "M6 hl. 12" }] });
    const dims = dimTexts(d);
    expect(dims).toContain("2× M6 hl. 12");
    expect(dims).not.toContain("2× Ø5");
    expect(dims).toContain("Ø20");
  });
});

describe("mezipaměť projekcí", () => {
  it("druhý výkres téhož tělesa (jiné razítko) je výrazně rychlejší a má stejnou geometrii", () => {
    const s = plate();
    const t0 = performance.now();
    const a = makeDrawing(s, { name: "A", material: "Ocel" });
    const t1 = performance.now();
    const b = makeDrawing(s, { name: "B", material: "Nerez", author: "Test", tolerance: "ISO 2768-mK" });
    const t2 = performance.now();
    expect(b.polys.filter((p) => p.layer === "visible").length).toBe(a.polys.filter((p) => p.layer === "visible").length);
    expect(t2 - t1).toBeLessThan(Math.max(30, (t1 - t0) / 3));
  });
});

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { bomToCsv, defaultDrawingOptions, hatch, makeDrawing, type BomItem } from "./drawing";
import { drawingToPdf } from "./pdf";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

/** deska 80×50×20 s dírou Ø20 skrz a čtyřmi dírami Ø6 */
const plate = () => {
  let s = r.makeBox([-40, -25, 0], [40, 25, 20]) as r.Shape3D;
  s = s.cut(r.makeCylinder(10, 40, [0, 0, -10], [0, 0, 1]));
  for (const [x, y] of [[-30, -15], [30, -15], [-30, 15], [30, 15]]) s = s.cut(r.makeCylinder(3, 40, [x, y, -10], [0, 0, 1]));
  return s;
};
const meta = { name: "Deska", material: "Ocel S235", massKg: 0.5, number: "MN-001", author: "Test", revision: "A" };

describe("výkres", () => {
  it("3 pohledy + izometrie, razítko, osy a průměry", () => {
    const d = makeDrawing(plate(), meta);
    expect(d.sheet.name).toBe("A4");
    expect(d.sheet.w).toBe(297);
    expect(d.svg).toContain("Mnástrojárna");
    expect(d.svg).toContain("MN-001");
    expect(d.polys.some((p) => p.layer === "hidden")).toBe(true);
    expect(d.polys.some((p) => p.layer === "center")).toBe(true);
    const labels = d.texts.map((t) => t.s);
    expect(labels).toContain("80");
    expect(labels.some((s) => s === "4× Ø6")).toBe(true);
    expect(labels.some((s) => s === "Ø20")).toBe(true);
    expect(d.warnings).toEqual([]);
  });

  it("volba pohledů, měřítka a listu", () => {
    const d = makeDrawing(plate(), meta, {
      ...defaultDrawingOptions,
      sheet: "A3",
      scale: 2,
      projection: "A",
      views: { front: true, top: true, left: false, right: true, back: true, bottom: true, iso: false },
      hidden: false,
    });
    expect(d.sheet).toEqual({ name: "A3", w: 420, h: 297 });
    expect(d.scale).toBe("2:1");
    expect(d.polys.some((p) => p.layer === "hidden")).toBe(false);
  });

  it("řez A–A se šrafováním a čárou řezu", () => {
    const d = makeDrawing(plate(), meta, { section: { plane: "XZ", offset: 0 } });
    expect(d.warnings).toEqual([]);
    expect(d.polys.filter((p) => p.layer === "hatch").length).toBeGreaterThan(10);
    expect(d.polys.some((p) => p.layer === "cut")).toBe(true);
    expect(d.texts.some((t) => t.s === "A–A")).toBe(true);
  });

  it("řez mimo těleso hlásí varování", () => {
    const d = makeDrawing(plate(), meta, { section: { plane: "XY", offset: 500 } });
    expect(d.warnings.length).toBeGreaterThan(0);
  });

  it("kusovník nad razítkem + CSV", () => {
    const bom: BomItem[] = [
      { pos: 2, name: "Šroub M8×20", number: "ISO 4762", qty: 4, material: "8.8" },
      { pos: 1, name: "Deska", number: "MN-001", qty: 1, material: "S235", massKg: 0.5 },
    ];
    const d = makeDrawing(plate(), { ...meta, bom });
    for (const s of ["Poz.", "Šroub M8×20", "ISO 4762", "Číslo výkresu / normy"]) expect(d.texts.some((t) => t.s === s)).toBe(true);
    // poz. 1 je níž (blíž razítku) než poz. 2
    const y1 = d.texts.find((t) => t.s === "Deska" && t.size === 2.8)!.y;
    const y2 = d.texts.find((t) => t.s === "Šroub M8×20")!.y;
    expect(y1).toBeGreaterThan(y2);
    expect(d.dxf).toContain("ISO 4762");
    const csv = bomToCsv(bom);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("1;Deska;MN-001;1;S235;0,5;\r\n2;Šroub M8×20;ISO 4762;4;8.8;;");
  });

  it("šrafy uvnitř čtverce", () => {
    const h = hatch([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], 1);
    expect(h.length).toBeGreaterThan(10);
    for (const seg of h) for (const [x, y] of seg) expect(x >= -1e-6 && x <= 10 + 1e-6 && y >= -1e-6 && y <= 10 + 1e-6).toBe(true);
  });

  it("DXF R12 s typy čar a vrstvami", () => {
    const d = makeDrawing(plate(), meta);
    for (const k of ["AC1009", "LTYPE", "HIDDEN", "CENTER", "OBRYS", "SKRYTE", "OSY", "KOTY", "RAM", "STYLE", "EOF"]) expect(d.dxf).toContain(k);
    expect(d.dxf).toContain("\\U+00E1"); // „á“ v názvu firmy
    expect(/[^\x00-\x7f]/.test(d.dxf)).toBe(false);
  });

  it("PDF (vektor, vložené písmo)", async () => {
    const d = makeDrawing(plate(), meta, { section: { plane: "YZ", offset: 0 } });
    const font = (n: string) => {
      const b = fs.readFileSync(path.resolve(__dirname, "../../public/fonts", n));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const blob = await drawingToPdf(d, { regular: font("Roboto-Regular.ttf"), bold: font("Roboto-Bold.ttf") });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5000);
    fs.mkdirSync("/tmp/claude-0/wc", { recursive: true });
    fs.writeFileSync("/tmp/claude-0/wc/test.pdf", bytes);
    fs.writeFileSync("/tmp/claude-0/wc/test.svg", d.svg);
  }, 30_000);
});

describe("uživatelské kóty a poznámky", async () => {
  const { annotationGeometry, withAnnotations, viewAt, sheetToAnn, annToSheet } = await import("./drawing");
  const base = { sheet: { name: "A4" as const, w: 297, h: 210 }, views: [{ key: "front", px: 40, py: 40, s: 0.5, x0: -50, y0: -20, w: 100, h: 40 }], scale: "1:2", scaleValue: 0.5, polys: [], texts: [], svg: "", dxf: "", warnings: [] };
  it("kóta ukazuje rozměr v jednotkách modelu nezávisle na měřítku", () => {
    const g = annotationGeometry(base, [{ id: "d1", view: "front", type: "dim", kind: "horizontal", a: [-50, 20], b: [50, 20], offset: 8 }]);
    expect(g.texts[0].s).toBe("100");
    expect(g.polys.filter((p) => p.fill)).toHaveLength(2); // dvě šipky
    const g2 = annotationGeometry(base, [{ id: "d2", view: "sheet", type: "dim", kind: "aligned", a: [0, 0], b: [30, 40], offset: 5 }]);
    expect(g2.texts[0].s).toBe("100"); // 50 mm listu / 0,5
  });
  it("poznámka, drsnost, tolerance, základna a text vytvoří geometrii; withAnnotations přegeneruje SVG/DXF", () => {
    const anns = [
      { id: "n", view: "front", type: "note" as const, at: [0, -30] as [number, number], leader: [0, 0] as [number, number], text: "Ostré hrany srazit" },
      { id: "r", view: "front", type: "roughness" as const, at: [10, 20] as [number, number], ra: "Ra 1,6" },
      { id: "g", view: "front", type: "gdt" as const, at: [20, -40] as [number, number], symbol: "perp" as const, value: "0,05", datum: "A", leader: [20, -20] as [number, number] },
      { id: "a", view: "front", type: "datum" as const, at: [-40, 20] as [number, number], label: "A" },
      { id: "t", view: "sheet", type: "text" as const, at: [150, 190] as [number, number], text: "Kalit 58 HRC", size: 4 },
    ];
    const r = withAnnotations(base, anns);
    expect(r.polys.length).toBeGreaterThan(10);
    expect(r.svg).toContain("Ostré hrany srazit");
    expect(r.svg).toContain("Ra 1,6");
    expect(r.dxf).toContain("Kalit 58 HRC");
  });
  it("mapování list ↔ pohled", () => {
    const v = base.views[0];
    const sheet = annToSheet(base.views, "front", [0, 0]);
    expect(sheet).toEqual([65, 50]);
    expect(sheetToAnn(v, sheet)).toEqual([0, 0]);
    expect(viewAt(base.views, [60, 45])?.key).toBe("front");
    expect(viewAt(base.views, [250, 150])).toBeNull();
  });
});

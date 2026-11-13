import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { bomToCsv, defaultDrawingOptions, hatch, makeDrawing, type BomItem } from "./drawing";
import { drawingToPdf } from "./pdf";
import type { Vec3 } from "./types";

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
    const d = makeDrawing(plate(), meta, { hidden: true });
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

describe("tabulka děr, pozice, detail, revize, listy", () => {
  it("tabulka děr desky: 4× Ø6 (A1–A4) a 1× Ø20 (B1), značky v půdorysu", () => {
    const d = makeDrawing(plate(), meta, { holeTable: true, views: { ...defaultDrawingOptions.views, top: true } });
    expect(d.holes).toBeDefined();
    const tags = d.holes!.map((h) => h.tag);
    expect(tags).toEqual(["A1", "A2", "A3", "A4", "B1"]);
    expect(d.holes!.filter((h) => h.d === 6)).toHaveLength(4);
    expect(d.holes![4].d).toBe(20);
    expect(d.svg).toContain("Tabulka děr");
    expect(d.svg).toContain("B1");
    // souřadnice relativně k levé dolní díře
    const a1 = d.holes![0];
    expect(a1.x).toBe(0);
    expect(d.holes!.map((h) => h.x)).toContain(60);
  });
  it("pozice (balónky) = počet komponent, odkazy na průmět středu", () => {
    const comps = [
      { pos: 1, name: "Deska", bbox: [[-40, -25, 0], [40, 25, 20]] as [Vec3, Vec3] },
      { pos: 2, name: "Čep", bbox: [[-5, -5, 0], [5, 5, 20]] as [Vec3, Vec3] },
      { pos: 3, name: "Šroub", bbox: [[25, 10, 0], [35, 20, 20]] as [Vec3, Vec3] },
    ];
    const d = makeDrawing(plate(), { ...meta, components: comps }, { balloons: true });
    expect(d.balloons).toHaveLength(3);
    expect(d.balloons!.map((b) => b.pos).sort()).toEqual([1, 2, 3]);
    const off = makeDrawing(plate(), { ...meta, components: comps }, { balloons: false });
    expect(off.balloons).toBeUndefined();
    // balónky zůstávají uvnitř rámu listu (okraj 10 mm nahoře, razítko dole) – i na malém formátu s velkým měřítkem
    for (const sheet of ["A4", "A3", "A2"] as const) {
      const big = makeDrawing(plate(), { ...meta, components: comps }, { balloons: true, sheet, scale: sheet === "A4" ? 2 : 1 });
      for (const b of big.balloons ?? []) {
        expect(b.y - 4, `${sheet} balónek ${b.pos} nad rámem`).toBeGreaterThanOrEqual(10);
        expect(b.y + 4, `${sheet} balónek ${b.pos} pod rámem`).toBeLessThanOrEqual(big.sheet.h - 10 - 38);
        expect(b.x - 4).toBeGreaterThanOrEqual(20);
        expect(b.x + 4).toBeLessThanOrEqual(big.sheet.w - 10);
      }
    }
  });
  it("detailní pohled: oříznutá kopie v měřítku 2:1 s popiskem", () => {
    const d = makeDrawing(plate(), meta, { details: [{ id: "d1", label: "A", view: "front", cx: 0, cy: 0, r: 15, scale: 2 }] });
    expect(d.details).toHaveLength(1);
    expect(d.details![0].w).toBeCloseTo(60, 6);
    expect(d.svg).toContain("A (2:1)");
    const bad = makeDrawing(plate(), meta, { details: [{ id: "d2", label: "B", view: "front", cx: 500, cy: 500, r: 5, scale: 2 }] });
    expect(bad.warnings.join(" ")).toMatch(/Detail B/);
  });
  it("tabulka revizí a číslo listu v razítku", () => {
    const d = makeDrawing(plate(), { ...meta, revisions: [{ rev: "A", date: "1. 11. 2026", note: "První vydání", author: "VV" }, { rev: "B", date: "2. 11. 2026", note: "Změna Ø20 → Ø22" }], sheetIndex: 2, sheetCount: 3 });
    expect(d.svg).toContain("Popis změny");
    expect(d.svg).toContain("První vydání");
    expect(d.svg).toContain("List 2/3");
  });
});

describe("kóty podle vybrané geometrie (kružnice Ø / R, hrana, úhel)", async () => {
  const { pathToEntities, fitCircle, pickViewEnt, arcCoverage, dimFromPicks, angleGeom, resolveDim, annotationStatus, annotationGeometry, withAnnotations } = await import("./drawing");
  type Ent = ReturnType<typeof pathToEntities>[number];
  type Ann = Parameters<typeof annotationGeometry>[1][number];
  const V2 = (x: number, y: number): [number, number] => [x, y];
  const lines = (e: Ent[]) => e.filter((x) => x.t === "line") as Extract<Ent, { t: "line" }>[];
  const arcs = (e: Ent[]) => e.filter((x) => x.t === "arc") as Extract<Ent, { t: "arc" }>[];
  const deg = (rad: number) => (rad * 180) / Math.PI;

  // skutečné cesty z projekce (HLR): deska 100×60 s dírou Ø12 se zahloubením Ø18, zaoblené rohy R8
  const TOP = [
    "M 0 -8 L 0 -52 A 8 8 0 0 1 8 -60 L 92 -60 A 8 8 0 0 1 100 -52 L 100 -8 A 8 8 0 0 1 92 0 L 8 0 A 8 8 0 0 1 0 -8 Z",
    "M 39 -30 A 9 9 0 0 0 21 -30 A 9 9 0 0 0 39 -30 Z",
    "M 36 -30 A 6 6 0 0 0 24 -30 A 6 6 0 0 0 36 -30 Z",
  ];
  const topEnts = TOP.flatMap((p) => pathToEntities(p));

  it("cesta pohledu → hrany, oblouky a celé kružnice s přesným středem a poloměrem", () => {
    expect(lines(topEnts)).toHaveLength(4);
    const a = arcs(topEnts);
    expect(a.filter((x) => Math.abs(Math.abs(x.da) - 2 * Math.PI) < 1e-9).map((x) => [x.c[0], x.c[1], x.r])).toEqual([[30, -30, 9], [30, -30, 6]]);
    const fillets = a.filter((x) => Math.abs(x.r - 8) < 1e-9);
    expect(fillets).toHaveLength(4);
    for (const f of fillets) expect(Math.abs(deg(f.da))).toBeCloseTo(90, 6);
    expect(fillets.map((f) => f.c.map((v) => Math.round(v * 1e6) / 1e6))).toContainEqual([8, -52]);
    const top = lines(topEnts).find((l) => l.a[1] === -60 && l.b[1] === -60)!;
    expect(Math.abs(top.b[0] - top.a[0])).toBe(84);
  });

  it("kružnice viděná z boku (řada krátkých kroků tam a zpět) je jedna hrana; navazující kolineární kroky se spojí", () => {
    // spodní hrana čelního pohledu: zaoblení z boku (0→8), rovná část (8→92), zaoblení (92→100)
    const e = pathToEntities("M 0 0 L 0.0503 0 L 0.20058 0 L 0.79225 0 L 3.01208 0 L 8 0 L 92 0 L 96.98792 0 L 99.79942 0 L 100 0", true);
    expect(e).toEqual([{ t: "line", a: [0, 0], b: [100, 0], hidden: true }]);
    // díra z boku: 36 → 24 → 36
    const h = pathToEntities("M 36 0 L 35.84957 0 L 33.74094 0 L 30 0 L 26.25906 0 L 24.15043 0 L 24 0 L 24.15043 0 L 30 0 L 35.84957 0 L 36 0");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ t: "line", a: [36, 0], b: [24, 0] });
    // lomená čára se dvěma hranami a rohem
    const c = pathToEntities("M 0 0 L 0 -17 L 3 -20");
    expect(lines(c).map((l) => [l.a, l.b])).toEqual([[[0, 0], [0, -17]], [[0, -17], [3, -20]]]);
  });

  it("obrys zaoblení z Bézierových křivek se proloží kružnicí; elipsa a lomená náhrada křivky nejsou hrana ani kružnice", () => {
    // čtvrtkružnice R5 se středem (−15, −25) jako tři kubiky (obrys anuloidu z projekce)
    const seg = (a0: number, a1: number) => {
      const R = 5;
      const cx = -15;
      const cy = -25;
      const t = (4 / 3) * Math.tan((a1 - a0) / 4) * R; // délka tečny řídicích bodů
      const p0 = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)];
      const p3 = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
      const c1 = [p0[0] - t * Math.sin(a0), p0[1] + t * Math.cos(a0)];
      const c2 = [p3[0] + t * Math.sin(a1), p3[1] - t * Math.cos(a1)];
      const f = (v: number[]) => v.map((x) => x.toFixed(5)).join(" ");
      return { p0, d: `C ${f(c1)} ${f(c2)} ${f(p3)}` };
    };
    const s = [seg(Math.PI, (7 * Math.PI) / 6), seg((7 * Math.PI) / 6, (4 * Math.PI) / 3), seg((4 * Math.PI) / 3, (3 * Math.PI) / 2)];
    const e = pathToEntities(`M -20 0 L -20 -25 ${s.map((x) => x.d).join(" ")}`);
    expect(lines(e)).toHaveLength(1);
    const a = arcs(e);
    expect(a).toHaveLength(1);
    expect(a[0].r).toBe(5);
    expect(a[0].c[0]).toBeCloseTo(-15, 3);
    expect(a[0].c[1]).toBeCloseTo(-25, 3);
    expect(Math.abs(deg(a[0].da))).toBeCloseTo(90, 2);
    // elipsa (kružnice viděná šikmo)
    expect(pathToEntities("M 10 0 A 10 4 0 0 0 -10 0 A 10 4 0 0 0 10 0 Z")).toEqual([]);
    // lomená náhrada křivky (parabola po 15 bodech) – žádné „hrany“ o délce kroku
    const para = Array.from({ length: 15 }, (_, i) => `${i === 0 ? "M" : "L"} ${i * 2} ${(-(i * 2) * (i * 2)) / 40}`).join(" ");
    expect(pathToEntities(para)).toEqual([]);
    // dlouhá hrana tečně navazující na takovou křivku zůstane
    const withEdge = pathToEntities("M -50 0 " + Array.from({ length: 15 }, (_, i) => `L ${i * 2} ${(-(i * 2) * (i * 2)) / 40}`).join(" "));
    expect(withEdge).toEqual([{ t: "line", a: [-50, 0], b: [0, 0] }]);
    // … i když leží uprostřed mezi dvěma takovými křivkami
    const step = (x0: number, dir: 1 | -1) => Array.from({ length: 6 }, (_, i) => `L ${x0 + dir * (i + 1) * 2} ${(-((i + 1) * 2) * ((i + 1) * 2)) / 40}`);
    const mid = pathToEntities(`M -62 -3.6 ${step(-50, -1).reverse().slice(1).join(" ")} L -50 0 L 0 0 ${step(0, 1).join(" ")}`);
    expect(mid).toEqual([{ t: "line", a: [-50, 0], b: [0, 0] }]);
    expect(fitCircle([[1, 0], [0, 1], [-1, 0], [0, -1]])).toMatchObject({ c: [0, 0], r: 1 });
    expect(fitCircle([[0, 0], [1, 1], [2, 2]])).toBeNull();
  });

  it("výběr pod kurzorem: kružnice na obvodu, střed uprostřed, hrana uprostřed, bod u konce; viditelná hrana má přednost", () => {
    expect(pickViewEnt(topEnts, [36.3, -30.2], 2)).toEqual({ kind: "circle", c: [30, -30], r: 6, full: true });
    expect(pickViewEnt(topEnts, [39, -30.5], 2)).toMatchObject({ kind: "circle", r: 9, full: true });
    expect(pickViewEnt(topEnts, [30.4, -30.2], 2)).toEqual({ kind: "point", p: [30, -30] });
    expect(pickViewEnt(topEnts, [50, -60.5], 2)).toMatchObject({ kind: "line", a: [8, -60], b: [92, -60] });
    expect(pickViewEnt(topEnts, [9, -60.3], 2)).toEqual({ kind: "point", p: [8, -60] });
    // zaoblení rohu: oblouk 90° → výchozí poloměr (full = false)
    const q = V2(8 - 8 * Math.SQRT1_2, -52 - 8 * Math.SQRT1_2);
    expect(pickViewEnt(topEnts, q, 2)).toMatchObject({ kind: "circle", r: 8, full: false });
    expect(pickViewEnt(topEnts, [60, -20], 2)).toBeNull();
    // jen body / jen hrany
    expect(pickViewEnt(topEnts, [36.3, -30.2], 2, "point")).toBeNull();
    expect(pickViewEnt(topEnts, [10, -60.2], 2, "line")).toMatchObject({ kind: "line", a: [8, -60] });
    // hrany ležící na sobě: viditelná má přednost před skrytou, delší před kratší; malá kružnice (r pod dosahem) jde stále vybrat na obvodu
    const dup: Ent[] = [{ t: "line", a: [0, 0], b: [30, 0], hidden: true }, { t: "line", a: [2, 0], b: [8, 0] }, { t: "line", a: [0, 0], b: [20, 0] }];
    expect(pickViewEnt(dup, [5, 0.1], 1)).toEqual({ kind: "line", a: [0, 0], b: [20, 0] });
    const small: Ent[] = [{ t: "arc", c: [0, 0], r: 1, a0: 0, da: 2 * Math.PI }];
    expect(pickViewEnt(small, [1, 0], 2)).toMatchObject({ kind: "circle", r: 1 });
    expect(pickViewEnt(small, [0.1, 0], 2)).toEqual({ kind: "point", p: [0, 0] });
  });

  it("pokrytí kružnice oblouky: viditelná a skrytá část téže kružnice dohromady", () => {
    const half: Ent[] = [
      { t: "arc", c: [0, 0], r: 5, a0: 0, da: Math.PI * 1.1 },
      { t: "arc", c: [0, 0], r: 5, a0: Math.PI * 1.1, da: Math.PI * 0.9, hidden: true },
      { t: "arc", c: [20, 0], r: 5, a0: -0.5, da: 1 },
      { t: "arc", c: [20, 0], r: 5, a0: 0.2, da: 1, hidden: true },
    ];
    expect(arcCoverage(half, [0, 0], 5)).toBeCloseTo(2 * Math.PI, 9);
    expect(arcCoverage(half, [20, 0], 5)).toBeCloseTo(1.7, 9); // překryv se nepočítá dvakrát, oblouk přes 0° se rozdělí
    expect(pickViewEnt(half, [5 * Math.cos(1), 5 * Math.sin(1)], 1)).toMatchObject({ kind: "circle", full: true });
  });

  // pohled „top“ v měřítku 1:2 umístěný na listu; souřadnice pohledu = mm modelu
  const views = [{ key: "top", px: 40, py: 40, s: 0.5, x0: 0, y0: -60, w: 100, h: 60, ents: topEnts }];
  const D = { views, scaleValue: 0.5 };
  const modes = { linear: "auto" as const, circle: "auto" as const };
  const withId = <T extends object>(a: T | null, id = "x") => ({ ...(a as T), id }) as unknown as Ann;

  it("kružnice → průměr Ø (Shift / přepínač → poloměr R), oblouk → R; text, odkaz se šipkou a přípona", () => {
    const circle = { view: "top", pick: { kind: "circle" as const, c: V2(30, -30), r: 6, full: true } };
    // střed na listu = [55, 55], poloměr 3 mm; místo kóty 10 mm vpravo nahoru od středu
    const dia = dimFromPicks(D, [circle], [55 + 8, 55 - 6], modes)!;
    expect(dia).toMatchObject({ type: "dim", kind: "diameter", view: "top", c: [30, -30], r: 6, offset: 7 });
    expect(dia.kind === "diameter" && dia.ang).toBeCloseTo(-36.87, 2);
    expect(dimFromPicks(D, [circle], [70, 55], { ...modes, invert: true })).toMatchObject({ kind: "radius", r: 6, ang: 0, offset: 12 });
    expect(dimFromPicks(D, [circle], [70, 55], { ...modes, circle: "radius" })).toMatchObject({ kind: "radius" });
    const arc = { view: "top", pick: { kind: "circle" as const, c: V2(8, -52), r: 8, full: false } };
    expect(dimFromPicks(D, [arc], [30, 30], modes)).toMatchObject({ kind: "radius", r: 8 });
    expect(dimFromPicks(D, [arc], [30, 30], { ...modes, invert: true })).toMatchObject({ kind: "diameter" });

    const g = annotationGeometry(D, [withId({ ...dia, suffix: "H7" })]);
    expect(g.texts.map((t) => t.s)).toEqual(["Ø12H7", "(+0,018/0)"]); // pole tolerance ISO 286 s úchylkami
    expect(g.polys.filter((p) => p.fill)).toHaveLength(1); // šipka na kružnici
    const leader = g.polys.find((p) => !p.fill)!;
    expect(Math.hypot(leader.pts[0][0] - 55, leader.pts[0][1] - 55)).toBeCloseTo(3, 6); // začíná na kružnici (r = 6 · 0,5)
    expect(Math.hypot(leader.pts[1][0] - 55, leader.pts[1][1] - 55)).toBeCloseTo(10, 6); // zlom v místě kóty
    expect(leader.pts[2][1]).toBe(leader.pts[1][1]); // vodorovná police
    const rad = annotationGeometry(D, [withId(dimFromPicks(D, [circle], [70, 55], { ...modes, invert: true }))]);
    expect(rad.texts[0].s).toBe("R6");
    // text uvnitř kružnice: průměr = čára přes celou kružnici se dvěma šipkami
    const inner = annotationGeometry(D, [withId(dimFromPicks(D, [circle], [56, 55], modes))]);
    expect(inner.polys.filter((p) => p.fill)).toHaveLength(2);
  });

  it("hrana jedním kliknutím → délka (konce z geometrie); dva body → délková kóta jako dosud", () => {
    const edge = { view: "top", pick: { kind: "line" as const, a: V2(8, -60), b: V2(92, -60) } };
    const dm = dimFromPicks(D, [edge], [60, 30], modes)!;
    expect(dm).toMatchObject({ type: "dim", kind: "horizontal", a: [8, -60], b: [92, -60], edge: true, offset: -10 });
    expect(annotationGeometry(D, [withId(dm)]).texts[0].s).toBe("84");
    // šikmá hrana → skutečná délka (šikmá kóta), ne průmět
    const slant = { view: "top", pick: { kind: "line" as const, a: V2(0, 0), b: V2(40, -30) } };
    const sd = dimFromPicks(D, [slant], [0, 0], modes)!;
    expect(sd).toMatchObject({ kind: "aligned", edge: true });
    expect(annotationGeometry({ views: [{ ...views[0], ents: undefined }], scaleValue: 0.5 }, [withId(sd)]).texts[0].s).toBe("50");
    expect(dimFromPicks(D, [slant], [0, 0], { ...modes, linear: "horizontal" })).toMatchObject({ kind: "horizontal" });
    // dva body
    const p = (x: number, y: number) => ({ view: "top", pick: { kind: "point" as const, p: V2(x, y) } });
    expect(dimFromPicks(D, [p(0, -8)], [0, 0], modes)).toBeNull();
    const two = dimFromPicks(D, [p(0, -8), p(100, -8)], [60, 80], modes)!;
    expect(two).toMatchObject({ kind: "horizontal", a: [0, -8], b: [100, -8] });
    expect("edge" in two).toBe(false);
    expect(annotationGeometry(D, [withId(two)]).texts[0].s).toBe("100");
    // druhý bod na listu mimo pohled se převede do souřadnic prvního pohledu
    const mixed = dimFromPicks(D, [p(0, -8), { view: "sheet", pick: { kind: "point" as const, p: V2(90, 66) } }], [60, 80], modes)!;
    expect(mixed).toMatchObject({ view: "top", b: [100, -8] });
  });

  it("dvě hrany → úhel se ° v sektoru podle místa kóty; rovnoběžné hrany → vzdálenost", () => {
    const l1 = { view: "top", pick: { kind: "line" as const, a: V2(0, 0), b: V2(40, 0) } };
    const l2 = { view: "top", pick: { kind: "line" as const, a: V2(60, -20), b: V2(80, -40) } }; // 45° k první (y dolů → stoupá)
    // průsečík přímek: [40, 0] → list [60, 70]
    const acute = dimFromPicks(D, [l1, l2], [60 + 20, 70 - 8], modes)!;
    expect(acute).toMatchObject({ type: "dim", kind: "angle", a: [0, 0], b: [40, 0], a2: [60, -20], b2: [80, -40] });
    const ga = annotationGeometry(D, [withId({ ...acute, suffix: "±1°" })]);
    expect(ga.texts[0].s).toBe("45°±1°");
    expect(ga.polys.filter((p) => p.fill)).toHaveLength(2);
    const obtuse = dimFromPicks(D, [l1, l2], [60 - 10, 70 - 15], modes)!;
    expect(annotationGeometry(D, [withId(obtuse)]).texts[0].s).toBe("135°");
    const g = angleGeom([0, 0], [10, 0], [0, 0], [0, 10], 45)!;
    expect(g.angle).toBeCloseTo(90, 9);
    expect(g.X).toEqual([0, 0]);
    expect(angleGeom([0, 0], [10, 0], [0, 5], [10, 5], 45)).toBeNull();
    // rovnoběžné hrany 60 mm od sebe
    const top = { view: "top", pick: { kind: "line" as const, a: V2(8, -60), b: V2(92, -60) } };
    const bottom = { view: "top", pick: { kind: "line" as const, a: V2(8, 0), b: V2(92, 0) } };
    const dist = dimFromPicks(D, [top, bottom], [70, 50], modes)!;
    expect(dist).toMatchObject({ type: "dim", kind: "vertical" });
    expect(annotationGeometry(D, [withId(dist)]).texts[0].s).toBe("60");
  });

  it("asociativita: kóta sleduje změnu průměru / délky hrany, ztracená geometrie a chybějící pohled se označí", () => {
    const dia = withId(dimFromPicks(D, [{ view: "top", pick: { kind: "circle", c: [30, -30], r: 6, full: true } }], [70, 50], modes), "d");
    const edge = withId(dimFromPicks(D, [{ view: "top", pick: { kind: "line", a: [8, -60], b: [92, -60] } }], [60, 30], modes), "e");
    const two = { id: "t", view: "top", type: "dim" as const, kind: "horizontal" as const, a: V2(0, -8), b: V2(100, -8), offset: 10 };
    expect(annotationStatus(D, [dia, edge, two])).toEqual({ d: "ok", e: "ok", t: "ok" });
    // model se změnil: díra Ø12 → Ø14 (bez zahloubení), deska 100 → 120
    const changed = [
      "M 0 -8 L 0 -52 A 8 8 0 0 1 8 -60 L 112 -60 A 8 8 0 0 1 120 -52 L 120 -8 A 8 8 0 0 1 112 0 L 8 0 A 8 8 0 0 1 0 -8 Z",
      "M 37 -30 A 7 7 0 0 0 23 -30 A 7 7 0 0 0 37 -30 Z",
    ].flatMap((p) => pathToEntities(p));
    const D2 = { views: [{ ...views[0], w: 120, ents: changed }], scaleValue: 0.5 };
    expect(annotationStatus(D2, [dia, edge, two])).toEqual({ d: "ok", e: "ok", t: "ok" });
    expect(annotationGeometry(D2, [dia, edge]).texts.map((t) => t.s)).toEqual(["Ø14", "104"]);
    // uložená kóta se nemění (drží původní údaje), dohledání je jen pro vykreslení
    expect(dia).toMatchObject({ r: 6 });
    // dvě různé soustředné kružnice bez shody → nejednoznačné; díra odstraněna → ztraceno
    expect(resolveDim(D.views, { ...(dia as Extract<Ann, { type: "dim" }>), r: 7.5 } as never).status).toBe("lost");
    const noHole = { views: [{ ...views[0], ents: changed.filter((e) => e.t === "line") }], scaleValue: 0.5 };
    expect(annotationStatus(noHole, [dia, edge, two])).toEqual({ d: "lost", e: "ok", t: "ok" });
    expect(annotationGeometry(noHole, [dia]).texts[0].s).toBe("Ø12"); // kreslí se podle uložených údajů
    // pohled není na listu → kóta se nekreslí a je označená (i dosavadní kóta dvou bodů a poznámka)
    const note = { id: "n", view: "top", type: "note" as const, at: V2(0, 0), text: "x" };
    const gone = { views: [{ ...views[0], key: "front" }], scaleValue: 0.5 };
    expect(annotationStatus(gone, [dia, edge, two, note])).toEqual({ d: "noView", e: "noView", t: "noView", n: "noView" });
    expect(annotationGeometry(gone, [dia, edge, two]).texts).toEqual([]);
    // starší výsledek bez entit pohledu: kóty se kreslí z uložených údajů
    const legacy = { views: [{ ...views[0], ents: undefined }], scaleValue: 0.5 };
    expect(annotationStatus(legacy, [dia, edge])).toEqual({ d: "ok", e: "ok" });
    expect(annotationGeometry(legacy, [dia]).texts[0].s).toBe("Ø12");
  });

  it("skutečná projekce: pohledy nesou hrany a kružnice; nové kóty jsou ve SVG, DXF i PDF", async () => {
    const d = makeDrawing(plate(), meta);
    const top = d.views.find((v) => v.key === "top")!;
    const front = d.views.find((v) => v.key === "front")!;
    expect(top.ents!.length).toBeGreaterThan(8);
    // díra Ø20 uprostřed: celá kružnice r = 10 se středem [0, 0]
    const big = top.ents!.find((e) => e.t === "arc" && Math.abs(e.r - 10) < 1e-6 && !e.hidden);
    expect(big).toBeDefined();
    expect(Math.hypot(...(big as Extract<Ent, { t: "arc" }>).c)).toBeLessThan(1e-6);
    expect(Math.abs((big as Extract<Ent, { t: "arc" }>).da)).toBeCloseTo(2 * Math.PI, 6);
    // horní hrana desky v čelním pohledu: 80 mm
    expect(front.ents!.some((e) => e.t === "line" && !e.hidden && Math.abs(Math.abs(e.b[0] - e.a[0]) - 80) < 1e-6 && Math.abs(e.a[1] - e.b[1]) < 1e-9)).toBe(true);
    // výběr kliknutím na obvod díry Ø6 [30, 15] v půdorysu (souřadnice pohledu: y dolů)
    const pick = pickViewEnt(top.ents!, [33, -15.05], 0.5);
    expect(pick).toMatchObject({ kind: "circle", full: true });
    expect(pick?.kind === "circle" && pick.r).toBeCloseTo(3, 6);
    const sel = [{ view: "top", pick: pick! }];
    const at = [top.px + (30 - top.x0) * top.s + 12, top.py + (-15 - top.y0) * top.s - 9] as [number, number];
    const dia = withId(dimFromPicks(d, sel, at, modes), "dia");
    const rad = withId(dimFromPicks(d, sel, [at[0], at[1] + 30], { ...modes, invert: true }), "rad");
    const edgePick = pickViewEnt(front.ents!, [20, front.y0 + 0.01], 0.5)!;
    expect(edgePick.kind).toBe("line");
    const len = withId({ ...dimFromPicks(d, [{ view: "front", pick: edgePick }], [front.px, front.py - 14], modes)!, suffix: "±0,1" }, "len");
    const l1 = front.ents!.find((e) => e.t === "line" && !e.hidden && Math.abs(e.a[0] - e.b[0]) < 1e-9)!;
    const ang = withId(dimFromPicks(d, [{ view: "front", pick: edgePick }, { view: "front", pick: { kind: "line", a: (l1 as Extract<Ent, { t: "line" }>).a, b: (l1 as Extract<Ent, { t: "line" }>).b } }], [front.px + 6, front.py + 6], modes), "ang");
    const out = withAnnotations(d, [{ ...(dia as object), suffix: "H7" } as Ann, rad, len, ang]);
    expect(annotationStatus(d, [dia, rad, len, ang])).toEqual({ dia: "ok", rad: "ok", len: "ok", ang: "ok" });
    for (const s of ["Ø6H7", "R3", "80±0,1", "90°"]) expect(out.texts.some((t) => t.s === s), s).toBe(true);
    expect(out.svg).toContain(">Ø6H7<");
    expect(out.svg).toContain(">90°<");
    // DXF: ne-ASCII znaky jako \U+XXXX (Ø = 00D8, ° = 00B0, ± = 00B1)
    expect(out.dxf).toContain("\\U+00D86H7");
    expect(out.dxf).toContain("\nR3\n");
    expect(out.dxf).toContain("80\\U+00B10,1");
    expect(out.dxf).toContain("90\\U+00B0");
    const font = (n: string) => {
      const b = fs.readFileSync(path.resolve(__dirname, "../../public/fonts", n));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const base = await drawingToPdf(d, { regular: font("Roboto-Regular.ttf"), bold: font("Roboto-Bold.ttf") });
    const pdf = await drawingToPdf(out, { regular: font("Roboto-Regular.ttf"), bold: font("Roboto-Bold.ttf") });
    expect(pdf.size).toBeGreaterThan(base.size);
  }, 60_000);
});

// ---------------------------------------------------------------- rozvržení výkresu soustruženého dílu (oběžné kolo 604200.001, model B)

describe("rozvržení výkresu: oběžné kolo B (řez, otočení, poloviční řez, skryté hrany, více modelů, výkon)", async () => {
  const { buildShape } = await import("./build");
  await import("./ext/index");
  await import("./feat/index");
  const { convexHull, pickViewEnt, dimFromPicks, annotationGeometry, projectionStats, textBox, modelViewKey } = await import("./drawing");
  type Res = ReturnType<typeof makeDrawing>;
  type V2 = [number, number];
  const fixture = (name: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures", name), "utf8"));
  const metaB = { name: "Oběžné kolo B", material: "ocel", number: "604200.001" };
  let B: r.Shape3D;
  beforeAll(async () => {
    B = (await buildShape(fixture("impeller-B.mncad.json"))).body!;
  }, 120_000);

  type Box = [number, number, number, number];
  const boxHit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  /** úsečka zasahuje do obdélníku (Liang–Barsky) */
  const segHit = (p: V2, q: V2, b: Box) => {
    let t0 = 0;
    let t1 = 1;
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    for (const [pp, qq] of [[-dx, p[0] - b[0]], [dx, b[2] - p[0]], [-dy, p[1] - b[1]], [dy, b[3] - p[1]]]) {
      if (pp === 0) {
        if (qq < 0) return false;
        continue;
      }
      const t = qq / pp;
      if (pp < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
    return true;
  };
  const inHull = (h: V2[], q: V2) => h.length > 2 && h.every((a, i) => {
    const b = h[(i + 1) % h.length];
    return (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) >= -1e-9;
  });
  /**
   * Čitelnost automatických kót: texty kót se nepřekrývají navzájem ani s jinými texty, neleží na žádné čáře listu
   * (obrysy, šrafy, osy, kótovací a vynášecí čáry, rám) a neleží uvnitř obrysu žádného pohledu.
   */
  const readability = (d: Res): string[] => {
    const out: string[] = [];
    const dims = d.texts.filter((t) => t.layer === "dim");
    const boxes = dims.map((t) => textBox(t) as Box);
    for (let i = 0; i < dims.length; i++) {
      for (let j = i + 1; j < dims.length; j++) if (boxHit(boxes[i], boxes[j])) out.push(`text ${dims[i].s} × ${dims[j].s}`);
      for (const o of d.texts) if (o.layer !== "dim" && boxHit(boxes[i], textBox(o) as Box)) out.push(`text ${dims[i].s} × ${o.s}`);
      for (const pl of d.polys) {
        if (pl.fill) continue;
        for (let k = 1; k < pl.pts.length; k++)
          if (segHit(pl.pts[k - 1] as V2, pl.pts[k] as V2, boxes[i])) {
            out.push(`čára ${pl.layer} × ${dims[i].s}`);
            break;
          }
      }
      for (const v of d.views) {
        const pts: V2[] = [];
        for (const e of v.ents ?? []) {
          if (e.t === "line") pts.push(e.a as V2, e.b as V2);
          else for (let k = 0; k <= 16; k++) pts.push([e.c[0] + e.r * Math.cos(e.a0 + (e.da * k) / 16), e.c[1] + e.r * Math.sin(e.a0 + (e.da * k) / 16)]);
        }
        const hull = convexHull(pts.map((q) => [v.px + (q[0] - v.x0) * v.s, v.py + (q[1] - v.y0) * v.s] as V2)) as V2[];
        const b = boxes[i];
        if ([[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]].some((q) => inHull(hull, q as V2))) out.push(`pohled ${v.key} × ${dims[i].s}`);
      }
      const [W, H] = [d.sheet.w, d.sheet.h];
      if (boxes[i][0] < 20 || boxes[i][1] < 10 || boxes[i][2] > W - 10 || boxes[i][3] > H - 10) out.push(`mimo rám ${dims[i].s}`);
    }
    return out;
  };
  const view = (d: Res, k: string) => d.views.find((v) => v.key === k)!;
  const diameters = (d: Res) => d.texts.filter((t) => t.layer === "dim" && /^Ø/.test(t.s)).map((t) => t.s);
  const save = (name: string, d: Res) => {
    fs.mkdirSync("/tmp/claude-0/wc", { recursive: true });
    fs.writeFileSync(`/tmp/claude-0/wc/${name}.svg`, d.svg);
  };

  it("výkon: projekce modelu B od nuly, s řezem, se skrytými hranami a otočená (mezipaměť projekcí)", () => {
    const times: Record<string, number> = {};
    const time = (label: string, sh: r.Shape3D, o: Parameters<typeof makeDrawing>[2]) => {
      const h0 = projectionStats.hlr;
      const t = performance.now();
      const d = makeDrawing(sh, metaB, o);
      times[label] = Math.round(performance.now() - t);
      return { d, hlr: projectionStats.hlr - h0 };
    };
    // 1) uživatelův případ: nový model, výkres rovnou s řezem (skryté hrany vypnuté = nové výchozí)
    const s1 = B.clone() as r.Shape3D;
    const first = time("řez od nuly", s1, { section: { plane: "XZ", offset: 0 } });
    expect(first.d.warnings).toEqual([]);
    expect(first.hlr).toBe(5); // čelní, půdorys, bokorys, izometrie + projekce odříznutého tělesa (řez)
    // 2) změny voleb nad týmž modelem už projekci nespouští
    const hid = time("+ skryté hrany", s1, { section: { plane: "XZ", offset: 0 }, hidden: true });
    expect(hid.hlr).toBe(0);
    expect(hid.d.polys.some((p) => p.layer === "hidden")).toBe(true);
    const off = time("bez řezu", s1, {});
    expect(off.hlr).toBe(0);
    const half = time("poloviční řez", s1, { section: { plane: "XZ", offset: 0, kind: "half" } });
    expect(half.hlr).toBe(1); // jen projekce tělesa bez čtvrtiny
    // otočení o 90°: hlavní pohled a řez jsou otočením hotových projekcí, nový směr má jen bokorys (pohled zdola)
    const rot = time("otočení 90° s řezem", s1, { rotation: 90, section: { plane: "XZ", offset: 0 } });
    expect(rot.hlr).toBeLessThanOrEqual(1);
    // 3) tentýž model od nuly bez řezu a se skrytými hranami (pro srovnání se stavem před úpravou)
    const s2 = B.clone() as r.Shape3D;
    time("bez řezu od nuly", s2, {});
    time("+ řez", s2, { section: { plane: "XZ", offset: 0 } });
    console.log("výkres modelu B [ms]:", JSON.stringify(times));
    // cíl zadání: projekce modelu B s řezem do 10 s (sdílený stroj – v testu s rezervou)
    expect(times["řez od nuly"]).toBeLessThan(20_000);
    expect(times["+ skryté hrany"] + times["bez řezu"]).toBeLessThan(5_000);
  }, 180_000);

  it("řez nemění formát listu: model B zůstane na A2 1:2, řez se položí do volného místa listu", () => {
    const plain = makeDrawing(B, metaB);
    const sec = makeDrawing(B, metaB, { section: { plane: "XZ", offset: 0 } });
    save("B-rez", sec);
    expect([plain.sheet.name, plain.scale]).toEqual(["A2", "1:2"]);
    expect([sec.sheet.name, sec.scale]).toEqual(["A2", "1:2"]);
    expect(sec.warnings).toEqual([]);
    // řez je na listu, uvnitř rámu, mimo razítko a nepřekrývá jiný pohled
    const rect = (v: Res["views"][number]) => ({ x: v.px, y: v.py, w: v.w * v.s, h: v.h * v.s });
    const s = rect(view(sec, "section"));
    expect(s.x).toBeGreaterThanOrEqual(20);
    expect(s.y).toBeGreaterThanOrEqual(10);
    expect(s.x + s.w).toBeLessThanOrEqual(sec.sheet.w - 10);
    expect(s.y + s.h).toBeLessThanOrEqual(sec.sheet.h - 10);
    for (const v of sec.views.filter((x) => x.key !== "section")) {
      const o = rect(v);
      expect(s.x < o.x + o.w && o.x < s.x + s.w && s.y < o.y + o.h && o.y < s.y + s.h, `řez × ${v.key}`).toBe(false);
    }
    // zadaný list a měřítko: řez se vejde → beze změny a bez varování
    const fixed = makeDrawing(B, metaB, { sheet: "A2", scale: 0.5, section: { plane: "XZ", offset: 0 } });
    expect([fixed.sheet.name, fixed.scale, fixed.warnings]).toEqual(["A2", "1:2", []]);
    // deska: řez na tomtéž listu ve stejném měřítku
    const p0 = makeDrawing(plate(), meta);
    const p1 = makeDrawing(plate(), meta, { section: { plane: "XZ", offset: 0 } });
    expect([p1.sheet.name, p1.scale]).toEqual([p0.sheet.name, p0.scale]);
  }, 120_000);

  it("když se pohledy s řezem opravdu nevejdou: zadaný list → varování, automatický list → větší formát nebo menší měřítko", () => {
    const tight = makeDrawing(B, metaB, { sheet: "A3", scale: 0.5, section: { plane: "XZ", offset: 0 } });
    expect(tight.warnings.join(" ")).toMatch(/nevejdou/);
    const auto = makeDrawing(B, metaB, { scale: 1, section: { plane: "XZ", offset: 0 } });
    expect(["A1", "A0"]).toContain(auto.sheet.name);
    expect(auto.scale).toBe("1:1");
  }, 120_000);

  it("automatické kóty průměrů: v řezu, v řadě na jedné straně, texty se nepřekrývají a neleží na čarách ani v pohledech", () => {
    const sec = makeDrawing(B, metaB, { section: { plane: "XZ", offset: 0 } });
    expect(sec.stacks).toEqual([{ view: "section", side: "b", count: 14 }]);
    expect(diameters(sec)).toEqual(["Ø42", "Ø45", "Ø49", "Ø90", "Ø100", "Ø102", "Ø120", "Ø236", "Ø257,6", "Ø272", "Ø338,4", "Ø365,4", "Ø416", "Ø430"]);
    expect(readability(sec)).toEqual([]);
    // řada roste od obrysu: menší průměr blíž pohledu, rozteč stejná
    const ys = sec.texts.filter((t) => t.layer === "dim" && /^Ø\d/.test(t.s) && t.s !== "16× Ø13").map((t) => t.y);
    const sv = view(sec, "section");
    expect(Math.min(...ys)).toBeGreaterThan(sv.py + sv.h * sv.s);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(6.5, 6);
    // bez řezu: řada pod bokorysem (průměry jsou vidět jako délky), také čitelná
    const plain = makeDrawing(B, metaB);
    expect(plain.stacks?.[0].count).toBe(14);
    expect(readability(plain)).toEqual([]);
    // poloviční řez a otočený pohled
    for (const o of [{ section: { plane: "XZ" as const, offset: 0, kind: "half" as const } }, { rotation: 90 as const, section: { plane: "XZ" as const, offset: 0 } }]) {
      const d = makeDrawing(B, metaB, o);
      expect(d.stacks?.[0]).toMatchObject({ view: "section", count: 14 });
      expect(readability(d), JSON.stringify(o)).toEqual([]);
    }
    // deska (bez soustružené osy): odkazy „n× Ø“ také čitelné
    expect(readability(makeDrawing(plate(), meta, { section: { plane: "XZ", offset: 0 } }))).toEqual([]);
  }, 120_000);

  it("otočení hlavního pohledu o 90° / 180° / 270°: obraz otočený, kóty z geometrie fungují", () => {
    const d0 = makeDrawing(B, metaB);
    const d90 = makeDrawing(B, metaB, { rotation: 90 });
    save("B-otoceni-90", d90);
    const f0 = view(d0, "front");
    const f90 = view(d90, "front");
    // osa dílu leží vodorovně: šířka a výška čelního pohledu se vymění
    expect(f90.w).toBeCloseTo(f0.h, 6);
    expect(f90.h).toBeCloseTo(f0.w, 6);
    // půdorys je průmětem otočeného hlavního pohledu (bokorys dílu), pohled zleva je čelní pohled na kružnice
    expect(view(d90, "top").h).toBeCloseTo(f0.w, 6);
    expect(view(d90, "left").ents!.some((e) => e.t === "arc" && Math.abs(e.r - 6.5) < 1e-3)).toBe(true);
    // výběr hrany v otočeném pohledu: čelo příruby Ø430 je svislá hrana délky 430
    const flange = f90.ents!.find((e) => e.t === "line" && !e.hidden && Math.abs(Math.abs(e.b[1] - e.a[1]) - 430) < 1e-3 && Math.abs(e.b[0] - e.a[0]) < 1e-6);
    expect(flange).toBeDefined();
    const fl = flange as Extract<typeof flange, { t: "line" }>;
    const mid: V2 = [(fl.a[0] + fl.b[0]) / 2, (fl.a[1] + fl.b[1]) / 2 + 37];
    const pick = pickViewEnt(f90.ents!, mid, 0.5)!;
    expect(pick).toMatchObject({ kind: "line" });
    const at: V2 = [f90.px - 20, f90.py + 40];
    const dim = dimFromPicks(d90, [{ view: "front", pick }], at, { linear: "auto", circle: "auto" })!;
    expect(dim).toMatchObject({ kind: "vertical", edge: true });
    expect(annotationGeometry(d90, [{ ...dim, id: "x" } as never]).texts[0].s).toBe("430");
    // díra Ø13 v pohledu na čelo
    const lv = view(d90, "left");
    const hole = lv.ents!.find((e) => e.t === "arc" && Math.abs(e.r - 6.5) < 1e-3) as Extract<NonNullable<typeof lv.ents>[number], { t: "arc" }>;
    const hp = pickViewEnt(lv.ents!, [hole.c[0] + 6.5, hole.c[1]], 0.3)!;
    expect(hp).toMatchObject({ kind: "circle", full: true });
    const hd = dimFromPicks(d90, [{ view: "left", pick: hp }], [lv.px + 10, lv.py + 10], { linear: "auto", circle: "auto" })!;
    expect(annotationGeometry(d90, [{ ...hd, id: "h" } as never]).texts[0].s).toBe("Ø13");
    // 180° a 270°: obraz zrcadlově podle středu / otočený opačně, rozměry sedí
    for (const rot of [180, 270] as const) {
      const d = makeDrawing(B, metaB, { rotation: rot });
      const f = view(d, "front");
      expect(rot === 180 ? [f.w, f.h] : [f.h, f.w]).toEqual([expect.closeTo(f0.w, 6), expect.closeTo(f0.h, 6)]);
      expect(d.warnings).toEqual([]);
    }
    // deska: 90° otočí čelní pohled 80 × 20 na 20 × 80
    const p = makeDrawing(plate(), meta, { rotation: 90 });
    expect(view(p, "front").w).toBeCloseTo(20, 6);
    expect(view(p, "front").h).toBeCloseTo(80, 6);
    expect(p.texts.some((t) => t.s === "4× Ø6")).toBe(true);
  }, 120_000);

  it("poloviční řez: polovina pohled / polovina řez podél osy, šrafy jen v řezané polovině, osa souměrnosti", () => {
    const d = makeDrawing(B, metaB, { section: { plane: "XZ", offset: 0, kind: "half" } });
    save("B-polovicni-rez", d);
    expect(d.warnings).toEqual([]);
    expect(d.texts.some((t) => t.s === "A–A")).toBe(true);
    const s = view(d, "section");
    const axisX = s.px + (0 - s.x0) * s.s; // osa dílu (x = 0) na listu
    const hatchPts = d.polys.filter((p) => p.layer === "hatch").flatMap((p) => p.pts);
    expect(hatchPts.length).toBeGreaterThan(20);
    for (const q of hatchPts) expect(q[0]).toBeGreaterThan(axisX - 1e-6);
    // osa souměrnosti (čerchovaná) přes celou výšku řezu
    expect(d.polys.some((p) => p.layer === "center" && Math.abs(p.pts[0][0] - axisX) < 1e-6 && Math.abs(p.pts[1][0] - axisX) < 1e-6 && Math.abs(p.pts[1][1] - p.pts[0][1]) > s.h * s.s)).toBe(true);
    // celý řez šrafuje obě poloviny
    const full = makeDrawing(B, metaB, { section: { plane: "XZ", offset: 0 } });
    const fs2 = view(full, "section");
    const fAxis = fs2.px + (0 - fs2.x0) * fs2.s;
    expect(full.polys.filter((p) => p.layer === "hatch").flatMap((p) => p.pts).some((q) => q[0] < fAxis - 5)).toBe(true);
    // deska (bez osy soustružení): poloviční řez podle středu obalu; dosavadní řezy XZ / YZ / XY dál fungují
    const ph = makeDrawing(plate(), meta, { section: { plane: "YZ", offset: 0, kind: "half" } });
    expect(ph.warnings).toEqual([]);
    expect(ph.polys.filter((p) => p.layer === "hatch").length).toBeGreaterThan(3);
    for (const plane of ["XZ", "YZ", "XY"] as const) {
      const x = makeDrawing(plate(), meta, { section: { plane, offset: plane === "XY" ? 10 : 0 } });
      expect(x.warnings, plane).toEqual([]);
      expect(x.polys.filter((p) => p.layer === "hatch").length, plane).toBeGreaterThan(5);
    }
  }, 120_000);

  it("skryté hrany jsou u nového výkresu vypnuté; zapnuté se kreslí čárkovaně", () => {
    expect(defaultDrawingOptions.hidden).toBe(false);
    expect(makeDrawing(plate(), meta).polys.some((p) => p.layer === "hidden")).toBe(false);
    expect(makeDrawing(plate(), meta, { hidden: true }).polys.some((p) => p.layer === "hidden")).toBe(true);
  });

  it("více modelů na jednom listu: vlastní měřítko s popiskem, kóty a výběr geometrie v pohledu dalšího modelu", () => {
    const pin = r.makeCylinder(15, 60, [0, 0, 0], [0, 0, 1]) as r.Shape3D;
    const models = [
      { id: "m1", name: "Čep", source: { kind: "doc" as const, doc: { app: "mnastrojarna-cad", version: 2, name: "Čep", material: "ocel", features: [] } as never }, view: "front" as const, scale: 1 },
      { id: "m2", name: "Deska", source: { kind: "component" as const, compId: "c1" }, view: "top" as const, scale: "auto" as const },
    ];
    const d = makeDrawing(B, metaB, { models }, { m1: pin, m2: plate() });
    save("B-vice-modelu", d);
    expect(d.warnings).toEqual([]);
    expect(d.models?.map((m) => [m.id, m.key, m.scale])).toEqual([["m1", modelViewKey("m1"), "1:1"], ["m2", modelViewKey("m2"), "1:2"]]);
    expect(d.texts.some((t) => t.s === "Čep (1:1)")).toBe(true);
    expect(d.texts.some((t) => t.s === "Deska (1:2)")).toBe(true);
    const pv = view(d, "m:m1");
    expect(pv.s).toBe(1);
    expect(pv.w).toBeCloseTo(30, 6);
    // pohledy se nepřekrývají a jsou uvnitř rámu
    const rects = d.views.map((v) => ({ k: v.key, x: v.px, y: v.py, w: v.w * v.s, h: v.h * v.s }));
    for (const a of rects) {
      expect(a.x >= 20 && a.y >= 10 && a.x + a.w <= d.sheet.w - 10 && a.y + a.h <= d.sheet.h - 10, a.k).toBe(true);
      for (const b of rects) if (a !== b) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.k} × ${b.k}`).toBe(false);
    }
    expect(readability(d)).toEqual([]);
    // kóta z geometrie v pohledu dalšího modelu (délka čepu 60)
    const edge = pv.ents!.find((e) => e.t === "line" && Math.abs(Math.abs(e.b[1] - e.a[1]) - 60) < 1e-6)!;
    const pick = pickViewEnt(pv.ents!, [(edge as { a: V2 }).a[0], -30], 0.3)!;
    const dm = dimFromPicks(d, [{ view: "m:m1", pick }], [pv.px - 15, pv.py + 30], { linear: "auto", circle: "auto" })!;
    expect(annotationGeometry(d, [{ ...dm, id: "z" } as never]).texts[0].s).toBe("60");
    // chybějící těleso dalšího modelu → varování, výkres hlavního modelu zůstane
    const miss = makeDrawing(plate(), meta, { models: [models[0]] });
    expect(miss.warnings.join(" ")).toMatch(/Čep/);
    expect(miss.models).toBeUndefined();
  }, 120_000);
});

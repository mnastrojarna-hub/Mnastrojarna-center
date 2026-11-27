/**
 * Razítko na skutečném výkrese (jádro OCCT): šablony, dlouhé texty bez zkracování, značka promítání, logo a nepředepsané
 * tolerance v SVG / DXF / PDF / DWG. Regrese zprávy 959 kap. 5.4 (reprodukce na bf91b0b: „Claude dle Vojtě“, název
 * uříznut na 46 znaků, číslo na 26, materiál na 28; značka ISO E zrcadlově a text „ISO E“).
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { DwgReader } from "@node-projects/acad-ts";
import { makeDrawing, withAnnotations, type DrawingMeta } from "./drawing";
import { drawingToDwg } from "./formats/dwg";
import { drawingToPdf } from "./pdf";
import { encodePng, toDataUrl, traceLogo } from "./title-logo";
import type { TitleLogo } from "./title-block";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

/** deska 120 × 80 × 20 s dírou Ø20 */
const plate = () => (r.makeBox([-60, -40, 0], [60, 40, 20]) as r.Shape3D).cut(r.makeCylinder(10, 40, [0, 0, -10], [0, 0, 1]));
const LONG: DrawingMeta = {
  name: "NASTROJ-A 100-01-00_01 – deska základová s dlouhým názvem pro kontrolu",
  material: "1.2379 (X153CrMoV12) kalené 58-60 HRC",
  number: "100-01-00_01-01-PRIKLADNA-DESKA",
  author: "Claude dle Vojtěchova zadání",
};
let logo: TitleLogo;

beforeAll(async () => {
  const w = 120;
  const h = 40;
  const rgba = new Uint8Array(w * h * 4).fill(255);
  for (let y = 8; y < 32; y++) for (let x = 10; x < 110; x++) rgba.set([224, 57, 48, 255], (y * w + x) * 4);
  const ras = { w, h, rgba };
  logo = { src: toDataUrl("image/png", await encodePng(ras)), w, h, name: "firma.png", trace: traceLogo(ras) };
});

const words = (s: string) => s.split(/\s+/).filter(Boolean);

describe("razítko na výkrese – nic se nezkracuje", () => {
  it("ISO 7200: název, číslo, materiál, kreslil celé (dřív 46 / 26 / 28 / 16 znaků)", () => {
    const d = makeDrawing(plate(), LONG);
    const all = d.texts.map((t) => t.s).join("\n");
    for (const v of [LONG.name, LONG.number!, LONG.material, LONG.author!]) for (const w of words(v)) expect(all, v).toContain(w);
    for (const cut of ["NASTROJ-A 100-01-00_01 – deska základová s dlo", "100-01-00_01-01-PRIKLADNA-", "1.2379 (X153CrMoV12) kalené ", "Claude dle Vojtě"]) expect(d.texts.map((t) => t.s)).not.toContain(cut);
    const tb = d.titleBlock!;
    expect(tb).toMatchObject({ template: "iso7200", w: 180, h: 38, projection: "E" });
    expect(tb.fields.filter((f) => f.where === "cell" && f.small)).toEqual([]);
    // řádky polí v buňkách složí zpět celý text
    for (const f of tb.fields.filter((x) => x.rows)) expect(f.rows!.join(" ").replace(/([-_]) /g, "$1"), f.key).toBe(f.value);
    expect(d.warnings).toEqual([]);
  });
  it("značka promítání ISO E: lichoběžník užším koncem vlevo, kružnice vpravo; žádný text „ISO E“", () => {
    const d = makeDrawing(plate(), LONG);
    const tb = d.titleBlock!;
    const inTb = (p: { pts: [number, number][] }) => p.pts.every(([x, y]) => x >= tb.x - 0.01 && x <= tb.x + tb.w + 0.01 && y >= tb.y - 0.01 && y <= tb.y + tb.h + 0.01);
    const trap = d.polys.find((p) => p.layer === "title" && p.width === 0.35 && p.pts.length === 5 && inTb(p))!;
    const circles = d.polys.filter((p) => p.layer === "title" && p.width === 0.35 && p.pts.length > 30 && inTb(p));
    expect(circles).toHaveLength(2);
    const xs = trap.pts.map((q) => q[0]);
    const h = (x: number) => {
      const ys = trap.pts.filter((q) => Math.abs(q[0] - x) < 1e-9).map((q) => q[1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(h(Math.min(...xs))).toBeLessThan(h(Math.max(...xs)));
    expect(Math.min(...circles[0].pts.map((q) => q[0]))).toBeGreaterThan(Math.max(...xs));
    expect(d.texts.some((t) => /^ISO [EA]$/.test(t.s))).toBe(false);
  });
});

describe("šablona nástrojářská + logo + nepředepsané tolerance ve všech formátech", () => {
  const meta = (): DrawingMeta => ({
    ...LONG,
    template: "toolmaker",
    logo,
    company: "Mnástrojárna s.r.o.",
    customer: "ACME a.s.",
    project: "123 PŘÍPRAVEK",
    checkedBy: "Ing. Kontrolor",
    approvedBy: "Ing. Schvalovatel",
    quantity: "4",
    stock: "plech 40×160×185",
    heatTreatment: "kalit 58–60 HRC",
    surfaceTreatment: "černit",
    tolerance: "X. ±0,1 / X.X ±0,1 / X.XX ±0,01 / X.XXX ±0,005",
    tolTable: ["±0,1", "±0,1", "±0,01", "±0,005"],
    angleTol: "±0°30′",
    chamferTol: "±0,2",
    edges: "ISO 13715 -0,3",
    revision: "B",
    massKg: 1.42,
  });
  it("rozvržení: pohledy nezasahují do vyššího razítka (180 × 64)", () => {
    const d = makeDrawing(plate(), meta());
    const tb = d.titleBlock!;
    expect([tb.template, tb.w, tb.h]).toEqual(["toolmaker", 180, 64]);
    for (const v of d.views) {
      const x1 = v.px + v.w * v.s;
      const y1 = v.py + v.h * v.s;
      const overlap = v.px < tb.x + tb.w && x1 > tb.x && v.py < tb.y + tb.h && y1 > tb.y;
      expect(overlap, v.key).toBe(false);
    }
    expect(tb.logo).toMatchObject({ name: "firma.png" });
    expect(tb.fields.filter((f) => f.where === "footer")).toEqual([]);
  });
  it("SVG: logo jako <image>, všechna pole; DXF: logo jako SOLID v červené (ACI 1) a pole", () => {
    const d = withAnnotations(makeDrawing(plate(), meta()), []);
    expect(d.svg).toMatch(/<image x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" preserveAspectRatio="xMidYMid meet" href="data:image\/png;base64,/);
    for (const s of ["ACME a.s.", "123 PŘÍPRAVEK", "Ing. Kontrolor", "Ing. Schvalovatel", "4 ks", "plech 40×160×185", "kalit 58–60 HRC", "černit", "±0°30′", "±0,2", "X.XXX ±0,005", "Kontroloval", "Schválil", "Polotovar", "Tepelné zpracování"])
      expect(d.svg, s).toContain(s.replace(/&/g, "&amp;"));
    // DXF po dvojicích (kód, hodnota): entity SOLID s barvou 62 = 1
    const L = d.dxf.split("\n");
    const ents: Record<string, string>[] = [];
    for (let i = 0; i + 1 < L.length; i += 2) {
      if (L[i].trim() === "0") ents.push({ type: L[i + 1] });
      else if (ents.length) ents[ents.length - 1][L[i].trim()] = L[i + 1];
    }
    const solids = ents.filter((e) => e.type === "SOLID" && e["62"] === "1");
    expect(solids.length).toBe(logo.trace!.rects.length / 4);
    expect(d.dxf).toContain("Ing. Kontrolor");
  });
  it("PDF: logo jako obrázek (XObject /Image), texty; DWG: SOLID loga a TEXT polí", async () => {
    const d = makeDrawing(plate(), meta());
    const font = (n: string) => {
      const b = fs.readFileSync(path.resolve(__dirname, "../../public/fonts", n));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const pdf = await drawingToPdf(d, { regular: font("Roboto-Regular.ttf"), bold: font("Roboto-Bold.ttf") });
    const bytes = Buffer.from(await pdf.arrayBuffer()).toString("latin1");
    expect(bytes).toMatch(/\/Subtype \/Image/);
    const dwg = await drawingToDwg(d, { version: "R2018" });
    const ents = [...DwgReader.readFromStream(dwg).entities!] as unknown as { objectName: string; value?: string }[];
    const tx = ents.filter((e) => e.objectName === "TEXT").map((e) => e.value ?? "");
    expect(tx).toEqual(expect.arrayContaining(["ACME a.s.", "Ing. Kontrolor", "Ing. Schvalovatel", "plech 40×160×185"]));
    expect(ents.filter((e) => e.objectName === "SOLID").length).toBeGreaterThanOrEqual(logo.trace!.rects.length / 4);
  }, 60_000);
  it("kompaktní šablona: menší razítko (+ technický pás 10 mm, vlna 23 R1), ostatní pole mimo šablonu v patičce", () => {
    const d = makeDrawing(plate(), { ...meta(), template: "compact" });
    expect([d.titleBlock!.h, d.titleBlock!.template]).toEqual([37, "compact"]);
    const foot = d.titleBlock!.footer.join(" ");
    for (const s of ["Zákazník: ACME a.s.", "Polotovar: plech 40×160×185", "Počet kusů: 4 ks"]) expect(foot, s).toContain(s);
    expect(foot).not.toMatch(/Nepředepsané tolerance|Tepelné zpracování|Povrchová úprava/);
    expect(d.titleBlock!.fields.find((f) => f.key === "tolerance")?.where).toBe("cell");
  });
});

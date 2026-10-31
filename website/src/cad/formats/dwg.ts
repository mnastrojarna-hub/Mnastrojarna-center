/**
 * Export DWG (AutoCAD) přímo v prohlížeči – knihovna @node-projects/acad-ts (MIT, port ACadSharp).
 * Žádné ODA SDK, žádný server: výkres (polys/texts z makeDrawing) nebo skica → CadDocument → DwgWriter.
 * Vrstvy, barvy ACI, typy čar a tloušťky odpovídají našemu DXF (OBRYS/SKRYTE/OSY/KOTY/SRAFY/RAM/TEXT).
 * Modul se načítá líně (import()) – hlavní bundle CAD zůstává malý.
 */
import {
  ACadVersion,
  Arc,
  CadDocument,
  Circle,
  Color,
  DwgWriter,
  type Entity,
  Layer,
  LineType,
  LineTypeSegment,
  LineWeightType,
  LwPolyline,
  MeasurementUnits,
  Point,
  Solid,
  TextEntity,
  TextHorizontalAlignment,
  TextStyle,
  UnitsType,
  XY,
  XYZ,
} from "@node-projects/acad-ts";
import type { DText, DrawingResult, Layer as DLayer, Poly } from "../drawing";
import { circleFrom3, entityPath } from "../sketch";
import type { SketchEntity, Vec2 } from "../types";
import { DWG_SIGNATURE, DWG_VERSIONS, type DwgVersion } from "./dwg-versions";

export { DWG_SIGNATURE, DWG_VERSIONS, type DwgVersion };

const ACAD: Record<DwgVersion, ACadVersion> = {
  R2000: ACadVersion.AC1015,
  R2004: ACadVersion.AC1018,
  R2007: ACadVersion.AC1021,
  R2010: ACadVersion.AC1024,
  R2013: ACadVersion.AC1027,
  R2018: ACadVersion.AC1032,
};


// ---------------------------------------------------------------- vrstvy a čáry

type LayerDef = { name: string; aci: number; lt: "CONTINUOUS" | "HIDDEN" | "CENTER"; lw: LineWeightType };

/** Vrstvy jako v DXF (drawing.ts → DXF_LAYER) + tloušťky dle ISO 128. */
const LAYERS: LayerDef[] = [
  { name: "OBRYS", aci: 7, lt: "CONTINUOUS", lw: LineWeightType.W50 },
  { name: "SKRYTE", aci: 8, lt: "HIDDEN", lw: LineWeightType.W25 },
  { name: "OSY", aci: 5, lt: "CENTER", lw: LineWeightType.W18 },
  { name: "KOTY", aci: 3, lt: "CONTINUOUS", lw: LineWeightType.W18 },
  { name: "SRAFY", aci: 9, lt: "CONTINUOUS", lw: LineWeightType.W18 },
  { name: "RAM", aci: 7, lt: "CONTINUOUS", lw: LineWeightType.W50 },
  { name: "TEXT", aci: 7, lt: "CONTINUOUS", lw: LineWeightType.W25 },
  { name: "POMOCNE", aci: 4, lt: "CENTER", lw: LineWeightType.W13 },
];

const DWG_LAYER: Record<DLayer, string> = {
  visible: "OBRYS",
  thin: "OBRYS",
  hidden: "SKRYTE",
  center: "OSY",
  cut: "OSY",
  dim: "KOTY",
  hatch: "SRAFY",
  frame: "RAM",
  title: "RAM",
};

/** Typy čar: délky segmentů v mm (záporné = mezera), stejné jako v DXF. */
const LTYPES: { name: string; desc: string; pat: number[] }[] = [
  { name: "HIDDEN", desc: "Hidden __ __ __", pat: [3, -1.5] },
  { name: "CENTER", desc: "Center ____ _ ____ _", pat: [12, -3, 1.5, -3] },
];

/** Tloušťka čáry [mm] → nejbližší LineWeightType (setiny mm). */
function weight(mm: number | undefined, fallback: LineWeightType): LineWeightType {
  if (mm == null) return fallback;
  const allowed = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
  const w = Math.round(mm * 100);
  return allowed.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a)) as LineWeightType;
}

type Ctx = { doc: CadDocument; layers: Map<string, Layer>; style: TextStyle; unicode: boolean };

/** Nový dokument s vrstvami, typy čar, stylem textu a jednotkami mm. */
function newDocument(version: DwgVersion): Ctx {
  const doc = new CadDocument(ACAD[version], true);
  const h = doc.header!;
  h.insUnits = UnitsType.Millimeters;
  h.measurementUnits = MeasurementUnits.Metric;
  h.lineTypeScale = 1;
  const unicode = ACAD[version] >= ACadVersion.AC1021;
  if (!unicode) h.codePage = "ANSI_1250";

  const lts = new Map<string, LineType>();
  lts.set("CONTINUOUS", doc.lineTypes!.tryGetValue("Continuous") ?? LineType.continuous);
  for (const { name, desc, pat } of LTYPES) {
    const lt = new LineType(name);
    lt.description = desc;
    for (const L of pat) {
      const s = new LineTypeSegment();
      s.length = L;
      lt.addSegment(s);
    }
    doc.lineTypes!.add(lt);
    lts.set(name, lt);
  }
  const layers = new Map<string, Layer>();
  for (const d of LAYERS) {
    const l = new Layer(d.name);
    l.color = new Color(d.aci);
    l.lineWeight = d.lw;
    l.lineType = lts.get(d.lt)!;
    doc.layers!.add(l);
    layers.set(d.name, l);
  }
  const style = new TextStyle("ISO");
  style.filename = "isocp.shx";
  doc.textStyles!.add(style);
  return { doc, layers, style, unicode };
}

/** Text pro starší verze (ANSI kódová stránka): znaky mimo ASCII jako \U+XXXX, které AutoCAD zobrazí správně. */
function encodeText(s: string, unicode: boolean) {
  if (unicode) return s;
  return s.replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
}

function toBuffer(doc: CadDocument): ArrayBuffer {
  const u8 = DwgWriter.writeToBuffer(doc);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------- výkres

function addPoly(ctx: Ctx, p: Poly, H: number) {
  const layer = ctx.layers.get(DWG_LAYER[p.layer] ?? "OBRYS")!;
  const Y = (y: number) => H - y;
  if (p.fill && p.pts.length >= 3) {
    const [a, b, c] = p.pts;
    const d = p.pts[3] ?? c;
    const so = new Solid(new XYZ(a[0], Y(a[1]), 0), new XYZ(b[0], Y(b[1]), 0), new XYZ(c[0], Y(c[1]), 0), new XYZ(d[0], Y(d[1]), 0));
    so.layer = layer;
    ctx.doc.entities!.add(so);
    return;
  }
  if (p.pts.length < 2) return;
  const pl = new LwPolyline(p.pts.map(([x, y]) => new XY(x, Y(y))));
  pl.layer = layer;
  if (p.width != null) pl.lineWeight = weight(p.width, LineWeightType.ByLayer);
  const first = p.pts[0];
  const last = p.pts[p.pts.length - 1];
  if (p.pts.length > 2 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) {
    pl.vertices.pop();
    pl.isClosed = true;
  }
  ctx.doc.entities!.add(pl);
}

function addText(ctx: Ctx, t: DText, H: number) {
  const te = new TextEntity(encodeText(t.s, ctx.unicode));
  te.layer = ctx.layers.get(t.layer === "dim" ? "KOTY" : "TEXT")!;
  te.style = ctx.style;
  te.height = t.size * 0.72; // výška verzálek ≈ 72 % velikosti písma v SVG (stejně jako DXF)
  te.rotation = (-(t.rotate ?? 0) * Math.PI) / 180; // SVG otáčí po směru hodinových ručiček, DWG proti
  const p = new XYZ(t.x, H - t.y, 0);
  te.insertPoint = p;
  te.alignmentPoint = p;
  te.horizontalAlignment = t.anchor === "middle" ? TextHorizontalAlignment.Center : t.anchor === "end" ? TextHorizontalAlignment.Right : TextHorizontalAlignment.Left;
  if (t.bold) te.widthFactor = 1.05;
  ctx.doc.entities!.add(te);
}

/**
 * Výkres (výsledek makeDrawing) → DWG. Souřadnice listu v mm, osa Y se obrací (DWG má počátek vlevo dole).
 * Šrafy a šipky kót jsou čáry/plošky (SOLID), kóty nejsou asociativní objekty DIMENSION.
 */
export async function drawingToDwg(d: Pick<DrawingResult, "polys" | "texts" | "sheet">, opts: { version?: DwgVersion } = {}): Promise<ArrayBuffer> {
  const version = opts.version ?? "R2018";
  if (!ACAD[version]) throw new Error(`Neznámá verze DWG: ${version}.`);
  try {
    const ctx = newDocument(version);
    const H = d.sheet.h;
    for (const p of d.polys) addPoly(ctx, p, H);
    for (const t of d.texts) addText(ctx, t, H);
    return toBuffer(ctx.doc);
  } catch (e) {
    throw new Error(`DWG se nepodařilo vytvořit (${version}): ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------- skica

const ang = (c: Vec2, p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/** Skica (2D entity v mm) → DWG: úsečky, kružnice a oblouky přesně, ostatní jako křivky (LWPOLYLINE). */
export async function sketchToDwg(entities: SketchEntity[], opts: { version?: DwgVersion } = {}): Promise<ArrayBuffer> {
  const version = opts.version ?? "R2018";
  if (!ACAD[version]) throw new Error(`Neznámá verze DWG: ${version}.`);
  try {
    const ctx = newDocument(version);
    const main = ctx.layers.get("OBRYS")!;
    const aux = ctx.layers.get("POMOCNE")!;
    for (const e of entities) {
      const layer = e.construction ? aux : main;
      let ent: Entity | null = null;
      if (e.type === "circle") ent = new Circle(new XYZ(e.cx, e.cy, 0), e.r);
      else if (e.type === "point") ent = new Point(new XYZ(e.p[0], e.p[1], 0));
      else if (e.type === "arc") {
        const c = circleFrom3(e.a, e.b, e.c);
        if (c) {
          // oblouk a → c přes b; DWG kreslí proti směru hodinových ručiček od startAngle do endAngle
          let s = norm(ang(c.c, e.a));
          let f = norm(ang(c.c, e.c));
          const m = norm(ang(c.c, e.b));
          const ccwContainsMid = norm(m - s) <= norm(f - s);
          if (!ccwContainsMid) [s, f] = [f, s];
          ent = new Arc(new XYZ(c.c[0], c.c[1], 0), c.r, s, f);
        }
      }
      if (!ent) {
        const { pts, closed } = entityPath(e);
        if (pts.length < 2) continue;
        const pl = new LwPolyline(pts.map(([x, y]) => new XY(x, y)));
        pl.isClosed = closed;
        ent = pl;
      }
      ent.layer = layer;
      ctx.doc.entities!.add(ent);
    }
    return toBuffer(ctx.doc);
  } catch (e) {
    throw new Error(`DWG skici se nepodařilo vytvořit (${version}): ${e instanceof Error ? e.message : String(e)}`);
  }
}

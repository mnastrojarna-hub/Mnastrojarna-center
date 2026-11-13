/**
 * Základní převod 2D výkresu ⇄ DWG / DXF přes @node-projects/acad-ts (port ACadSharp) – jádro fáze A.
 * Hladiny (barva ACI / pravá, typ čáry, tloušťka, zapnutá, zmrazená, zamčená, tisk), typy čar (vzory), hlavička
 * (INSUNITS, LTSCALE, CLAYER, LUPREC, AUPREC, PDMODE, PDSIZE, MIRRTEXT, LWDISPLAY) a entity jádra
 * (bod, úsečka, přímka, polopřímka, LWPOLYLINE s vydutím a šířkami, kružnice, oblouk, elipsa, spline, TEXT).
 * Ostatní entity (MTEXT, kóty, šrafy, bloky, rozvržení…) doplní balík 4 (io) – zde se jen spočítají v poznámce.
 * Modul se načítá líně (import()) – acad-ts je velký.
 */
import {
  ACadVersion,
  Arc,
  CadDocument,
  Circle,
  Color,
  DwgReader,
  DwgWriter,
  DxfReader,
  DxfWriter,
  Ellipse,
  type Entity,
  Layer,
  LayerFlags,
  Line,
  LineType,
  LineTypeSegment,
  LineWeightType,
  LwPolyline,
  LwPolylineVertex,
  MeasurementUnits,
  Point,
  Ray,
  Spline,
  TextEntity,
  TextHorizontalAlignment,
  TextStyle,
  TextVerticalAlignmentType,
  UnitsType,
  XLine,
  XY,
  XYZ,
} from "@node-projects/acad-ts";
import { tr } from "../../i18n";
import { DWG_VERSIONS, type DwgVersion } from "../../formats/dwg-versions";
import { hexRgb, rgbHex } from "../colors";
import { newDraftModel } from "../doc";
import { textFrame } from "../kinds-core";
import { LAYER0, snapLineweight, type DraftColor, type DraftEntity, type DraftLayer, type DraftLinetype, type DraftLw, type DraftModel, type NewEntity, type TextHAlign, type TextVAlign, type Vec2 } from "../model";
import { DraftTx } from "../tx";
import { UNITS, unitsFromCode } from "../units";
import "../kinds-core";

const ACAD: Record<DwgVersion, ACadVersion> = {
  R2000: ACadVersion.AC1015,
  R2004: ACadVersion.AC1018,
  R2007: ACadVersion.AC1021,
  R2010: ACadVersion.AC1024,
  R2013: ACadVersion.AC1027,
  R2018: ACadVersion.AC1032,
};
export const DRAFT_DWG_VERSIONS = DWG_VERSIONS;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const norm360 = (a: number) => ((a % 360) + 360) % 360;

// ---------------------------------------------------------------- model → CadDocument

function cadColor(c: DraftColor | undefined): Color {
  if (c === undefined || c === "ByLayer") return Color.byLayer;
  if (c === "ByBlock") return Color.byBlock;
  if (typeof c === "number") return new Color(c);
  const rgb = hexRgb(c);
  return rgb ? new Color(rgb[0], rgb[1], rgb[2]) : Color.byLayer;
}
function cadLw(lw: DraftLw | undefined): LineWeightType {
  if (lw === undefined || lw === "ByLayer") return LineWeightType.ByLayer;
  if (lw === "ByBlock") return LineWeightType.ByBlock;
  if (lw === "Default") return LineWeightType.Default;
  return Math.round(snapLineweight(lw) * 100) as LineWeightType;
}

/** 2D model → dokument acad-ts (modelový prostor). */
export function draftToCad(model: DraftModel, version: DwgVersion = "R2018"): CadDocument {
  const doc = new CadDocument(ACAD[version] ?? ACadVersion.AC1032, true);
  const v = model.vars;
  const h = doc.header!;
  h.insUnits = UNITS[v.units].code as UnitsType;
  h.measurementUnits = v.measurement ? MeasurementUnits.Metric : MeasurementUnits.English;
  h.lineTypeScale = v.ltscale;
  h.linearUnitPrecision = v.prec;
  h.angularUnitPrecision = v.aprec;
  h.pointDisplayMode = v.pdmode;
  h.pointDisplaySize = v.pdsize;
  h.mirrorText = !!v.mirrtext;
  h.displayLineWeight = v.lwdisplay;
  h.currentEntityLinetypeScale = v.celtscale;
  if (ACAD[version] < ACadVersion.AC1021) h.codePage = "ANSI_1250";
  // typy čar
  const lts = new Map<string, LineType>();
  lts.set("continuous", doc.lineTypes!.tryGetValue("Continuous") ?? LineType.continuous);
  for (const lt of model.linetypes) {
    if (/^(continuous|bylayer|byblock)$/i.test(lt.name)) continue;
    const L = new LineType(lt.name);
    L.description = lt.desc;
    for (const x of lt.pattern) {
      const s = new LineTypeSegment();
      s.length = x;
      L.addSegment(s);
    }
    doc.lineTypes!.add(L);
    lts.set(lt.name.toLowerCase(), L);
  }
  const ltOf = (n: string | undefined): LineType | null => {
    if (!n || /^bylayer$/i.test(n)) return null;
    if (/^byblock$/i.test(n)) return doc.lineTypes!.tryGetValue("ByBlock") ?? LineType.byBlock;
    return lts.get(n.toLowerCase()) ?? null;
  };
  // hladiny
  const layers = new Map<string, Layer>();
  for (const l of model.layers) {
    let L = doc.layers!.tryGetValue(l.name) ?? null;
    if (!L) {
      L = new Layer(l.name);
      doc.layers!.add(L);
    }
    L.color = typeof l.color === "number" ? new Color(l.color) : cadColor(l.color);
    L.lineType = ltOf(l.linetype) ?? lts.get("continuous")!;
    L.lineWeight = l.lineweight === "Default" ? LineWeightType.Default : cadLw(l.lineweight);
    L.isOn = l.on;
    L.layerFlags = (l.frozen ? LayerFlags.Frozen : 0) | (l.locked ? LayerFlags.Locked : 0);
    L.plotFlag = l.plot;
    layers.set(l.name, L);
  }
  try {
    h.currentLayerName = v.clayer;
  } catch {
    /* hladina chybí – výchozí 0 */
  }
  const styles = new Map<string, TextStyle>();
  for (const s of model.textStyles) {
    let S = doc.textStyles!.tryGetValue(s.name) ?? null;
    if (!S) {
      S = new TextStyle(s.name);
      doc.textStyles!.add(S);
    }
    S.filename = s.font;
    S.height = s.height;
    S.width = s.wf;
    S.obliqueAngle = rad(s.oblique);
    styles.set(s.name.toLowerCase(), S);
  }
  const unicode = (ACAD[version] ?? ACadVersion.AC1032) >= ACadVersion.AC1021;
  const enc = (s: string) => (unicode ? s : s.replace(/[^\x20-\x7e]/g, (ch) => `\\U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`));
  const ctx = { model };
  for (const e of model.entities) {
    const ent = toCadEntity(e, ctx, styles, enc);
    if (!ent) continue;
    ent.layer = layers.get(e.layer) ?? layers.get(LAYER0)!;
    ent.color = cadColor(e.color);
    const lt = ltOf(e.linetype);
    if (lt) ent.lineType = lt;
    ent.lineWeight = cadLw(e.lineweight);
    if (e.ltscale) ent.lineTypeScale = e.ltscale;
    doc.entities!.add(ent);
  }
  return doc;
}

const xyz = (p: Vec2) => new XYZ(p[0], p[1], 0);

function toCadEntity(e: DraftEntity, ctx: { model: DraftModel }, styles: Map<string, TextStyle>, enc: (s: string) => string): Entity | null {
  switch (e.type) {
    case "point":
      return new Point(xyz(e.p));
    case "line":
      return new Line(xyz(e.a), xyz(e.b));
    case "xline": {
      const x = new XLine();
      x.firstPoint = xyz(e.p);
      x.direction = xyz(e.dir);
      return x;
    }
    case "ray": {
      const r = new Ray();
      r.startPoint = xyz(e.p);
      r.direction = xyz(e.dir);
      return r;
    }
    case "circle":
      return new Circle(xyz(e.c), e.r);
    case "arc":
      return new Arc(xyz(e.c), e.r, rad(e.a0), rad(e.a1));
    case "polyline": {
      const pl = new LwPolyline(
        e.pts.map((p, i) => {
          const v = new LwPolylineVertex(new XY(p[0], p[1]));
          v.bulge = e.bulges?.[i] ?? 0;
          const w = e.widths?.[i];
          if (w) {
            v.startWidth = w[0];
            v.endWidth = w[1];
          }
          return v;
        }),
      );
      pl.isClosed = !!e.closed;
      if (e.width) pl.constantWidth = e.width;
      return pl;
    }
    case "ellipse": {
      const el = new Ellipse();
      el.center = xyz(e.c);
      el.majorAxisEndPoint = xyz(e.major);
      el.radiusRatio = e.ratio;
      el.startParameter = e.t0 === undefined ? 0 : rad(e.t0);
      el.endParameter = e.t1 === undefined ? 2 * Math.PI : rad(e.t1);
      return el;
    }
    case "spline": {
      const s = new Spline();
      s.degree = e.degree;
      s.controlPoints = e.ctrl.map(xyz);
      s.knots = [...e.knots];
      if (e.weights?.length) s.weights = [...e.weights];
      if (e.fit?.length) s.fitPoints = e.fit.map(xyz);
      if (e.closed) s.isClosed = true;
      return s;
    }
    case "text": {
      const t = new TextEntity(enc(e.s));
      const fr = textFrame(e, ctx);
      t.height = e.h;
      t.rotation = rad(e.rot ?? 0);
      t.widthFactor = e.wf ?? 1;
      t.obliqueAngle = rad(e.oblique ?? 0);
      const st = styles.get((e.style ?? ctx.model.vars.textstyle).toLowerCase());
      if (st) t.style = st;
      const H: Record<TextHAlign, TextHorizontalAlignment> = { left: TextHorizontalAlignment.Left, center: TextHorizontalAlignment.Center, right: TextHorizontalAlignment.Right, aligned: TextHorizontalAlignment.Aligned, middle: TextHorizontalAlignment.Middle, fit: TextHorizontalAlignment.Fit };
      const V: Record<TextVAlign, TextVerticalAlignmentType> = { baseline: TextVerticalAlignmentType.Baseline, bottom: TextVerticalAlignmentType.Bottom, middle: TextVerticalAlignmentType.Middle, top: TextVerticalAlignmentType.Top };
      t.horizontalAlignment = H[e.halign ?? "left"];
      t.verticalAlignment = V[e.valign ?? "baseline"];
      // DXF: 10 = levý konec účaří, 11 = bod zarovnání (u Zarovnat / Přizpůsobit druhý bod)
      t.insertPoint = xyz(e.halign === "aligned" || e.halign === "fit" ? e.p : fr.s);
      t.alignmentPoint = xyz(e.halign === "aligned" || e.halign === "fit" ? (e.p2 ?? e.p) : e.p);
      return t;
    }
  }
  return null;
}

// ---------------------------------------------------------------- CadDocument → model

function fromColor(c: Color | null | undefined): DraftColor | undefined {
  if (!c || c.isByLayer) return undefined;
  if (c.isByBlock) return "ByBlock";
  if (c.isTrueColor) return rgbHex([c.r, c.g, c.b]);
  return c.index >= 1 && c.index <= 255 ? c.index : undefined;
}
function fromLw(w: LineWeightType): DraftLw | undefined {
  if (w === LineWeightType.ByLayer || w === undefined) return undefined;
  if (w === LineWeightType.ByBlock) return "ByBlock";
  if (w === LineWeightType.Default || w < 0) return "Default";
  return snapLineweight(w / 100);
}
const v2 = (p: { x: number; y: number }): Vec2 => [p.x, p.y];

export type ImportNote = { skipped: Record<string, number>; entities: number; layers: number };

/** dokument acad-ts → 2D model; `offLayers` = hladiny vypnuté podle surového DXF (oprava čtení záporné barvy) */
export function cadToDraft(doc: CadDocument, offLayers: Map<string, number> = new Map()): { model: DraftModel; note: ImportNote } {
  const h = doc.header!;
  const base = newDraftModel({ units: unitsFromCode(Number(h.insUnits ?? 4)) });
  let model: DraftModel = {
    ...base,
    vars: {
      ...base.vars,
      ltscale: h.lineTypeScale || 1,
      prec: Number.isFinite(h.linearUnitPrecision) ? h.linearUnitPrecision : base.vars.prec,
      aprec: Number.isFinite(h.angularUnitPrecision) ? h.angularUnitPrecision : base.vars.aprec,
      pdmode: h.pointDisplayMode ?? 0,
      pdsize: h.pointDisplaySize ?? 0,
      mirrtext: h.mirrorText ? 1 : 0,
      lwdisplay: !!h.displayLineWeight,
      measurement: h.measurementUnits === MeasurementUnits.English ? 0 : 1,
    },
  };
  const linetypes: DraftLinetype[] = [{ name: "Continuous", desc: "Solid line", pattern: [] }];
  for (const lt of doc.lineTypes!) {
    if (/^(bylayer|byblock|continuous)$/i.test(lt.name)) continue;
    linetypes.push({ name: lt.name, desc: lt.description ?? "", pattern: [...(lt.segments ?? [])].map((s) => s.length) });
  }
  const layers: DraftLayer[] = [];
  for (const L of doc.layers!) {
    const col = L.color;
    const offAci = offLayers.get(L.name.toLowerCase());
    const color: number | string = col?.isTrueColor ? rgbHex([col.r, col.g, col.b]) : offAci !== undefined && offAci >= 1 && offAci <= 255 ? offAci : col && col.index >= 1 && col.index <= 255 ? col.index : 7;
    const ltn = L.lineType?.name ?? "Continuous";
    const flags = Number(L.layerFlags ?? 0);
    layers.push({
      name: L.name,
      color,
      linetype: /^continuous$/i.test(ltn) ? "Continuous" : ltn,
      lineweight: L.lineWeight === LineWeightType.Default || L.lineWeight < 0 ? "Default" : snapLineweight(L.lineWeight / 100),
      on: L.isOn && !offLayers.has(L.name.toLowerCase()),
      frozen: (flags & LayerFlags.Frozen) !== 0,
      locked: (flags & LayerFlags.Locked) !== 0,
      plot: L.plotFlag !== false,
    });
  }
  if (!layers.some((l) => l.name === LAYER0)) layers.unshift(base.layers[0]);
  model = { ...model, linetypes, layers };
  const clayer = h.currentLayerName;
  if (clayer && layers.some((l) => l.name === clayer && !l.frozen)) model.vars = { ...model.vars, clayer };
  const tx = new DraftTx(model);
  const skipped: Record<string, number> = {};
  let n = 0;
  for (const ent of doc.entities!) {
    const ne = fromCadEntity(ent);
    if (!ne) {
      const k = ent.objectName ?? ent.constructor.name;
      skipped[k] = (skipped[k] ?? 0) + 1;
      continue;
    }
    const layer = ent.layer?.name && layers.some((l) => l.name === ent.layer.name) ? ent.layer.name : LAYER0;
    const color = fromColor(ent.color);
    const ltn = ent.lineType?.name;
    const lw = fromLw(ent.lineWeight);
    const full = {
      ...ne,
      layer,
      ...(color !== undefined ? { color } : {}),
      ...(ltn && !/^bylayer$/i.test(ltn) ? { linetype: /^byblock$/i.test(ltn) ? "ByBlock" : /^continuous$/i.test(ltn) ? "Continuous" : ltn } : {}),
      ...(lw !== undefined ? { lineweight: lw } : {}),
      ...(ent.lineTypeScale && Math.abs(ent.lineTypeScale - 1) > 1e-12 ? { ltscale: ent.lineTypeScale } : {}),
      ...(ent.handle ? { ext: { handle: Number(ent.handle).toString(16).toUpperCase() } } : {}),
    } as NewEntity;
    // nový model má CECOLOR / CELTYPE / CELWEIGHT = ByLayer – entita si nese jen vlastní vlastnosti
    tx.add(full);
    n++;
  }
  return { model: tx.model, note: { skipped, entities: n, layers: layers.length } };
}

function fromCadEntity(ent: Entity): NewEntity | null {
  if (ent instanceof Line) return { type: "line", a: v2(ent.startPoint), b: v2(ent.endPoint) };
  if (ent instanceof Arc) {
    return { type: "arc", c: v2(ent.center), r: ent.radius, a0: norm360(deg(ent.startAngle)), a1: norm360(deg(ent.endAngle)) };
  }
  if (ent instanceof Circle) return { type: "circle", c: v2(ent.center), r: ent.radius };
  if (ent instanceof Point) return { type: "point", p: v2(ent.location) };
  if (ent instanceof XLine) return { type: "xline", p: v2(ent.firstPoint), dir: unitV(v2(ent.direction)) };
  if (ent instanceof Ray) return { type: "ray", p: v2(ent.startPoint), dir: unitV(v2(ent.direction)) };
  if (ent instanceof LwPolyline) {
    const vs = ent.vertices;
    if (vs.length < 2) return null;
    const pts = vs.map((v) => v2(v.location));
    const bulges = vs.map((v) => v.bulge ?? 0);
    const widths = vs.map((v) => [v.startWidth ?? 0, v.endWidth ?? 0] as [number, number]);
    return {
      type: "polyline",
      pts,
      ...(bulges.some((b) => Math.abs(b) > 1e-12) ? { bulges } : {}),
      ...(widths.some(([a, b]) => a > 0 || b > 0) ? { widths } : {}),
      ...(ent.constantWidth > 0 ? { width: ent.constantWidth } : {}),
      ...(ent.isClosed ? { closed: true } : {}),
    };
  }
  if (ent instanceof Ellipse) {
    const full = Math.abs(ent.endParameter - ent.startParameter - 2 * Math.PI) < 1e-9 || (ent.startParameter === 0 && ent.endParameter === 0);
    return { type: "ellipse", c: v2(ent.center), major: v2(ent.majorAxisEndPoint), ratio: ent.radiusRatio, ...(full ? {} : { t0: norm360(deg(ent.startParameter)), t1: norm360(deg(ent.endParameter)) }) };
  }
  if (ent instanceof Spline) {
    const ctrl = ent.controlPoints.map(v2);
    if (ctrl.length < 2 || ent.knots.length !== ctrl.length + ent.degree + 1) return null;
    return { type: "spline", degree: ent.degree, ctrl, knots: [...ent.knots], ...(ent.weights?.length && ent.weights.some((w) => w !== 1) ? { weights: [...ent.weights] } : {}), ...(ent.fitPoints?.length ? { fit: ent.fitPoints.map(v2) } : {}), ...(ent.isClosed ? { closed: true } : {}) };
  }
  if (ent instanceof TextEntity) {
    const hMap: TextHAlign[] = ["left", "center", "right", "aligned", "middle", "fit"];
    const vMap: TextVAlign[] = ["baseline", "bottom", "middle", "top"];
    const ha = hMap[Number(ent.horizontalAlignment) || 0] ?? "left";
    const va = vMap[Number(ent.verticalAlignment) || 0] ?? "baseline";
    const left = ha === "left" && va === "baseline";
    const p = left || ha === "aligned" || ha === "fit" ? v2(ent.insertPoint) : v2(ent.alignmentPoint);
    return {
      type: "text",
      p,
      h: ent.height,
      s: decodeText(ent.value),
      ...(ent.rotation ? { rot: norm360(deg(ent.rotation)) } : {}),
      ...(ent.style?.name && !/^standard$/i.test(ent.style.name) ? { style: ent.style.name } : {}),
      ...(ha !== "left" ? { halign: ha } : {}),
      ...(va !== "baseline" ? { valign: va } : {}),
      ...(ha === "aligned" || ha === "fit" ? { p2: v2(ent.alignmentPoint) } : {}),
      ...(ent.widthFactor && Math.abs(ent.widthFactor - 1) > 1e-9 ? { wf: ent.widthFactor } : {}),
      ...(ent.obliqueAngle ? { oblique: deg(ent.obliqueAngle) } : {}),
    };
  }
  return null;
}
const unitV = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
/** \U+XXXX a %%d / %%c / %%p (stupeň, průměr, ±) */
export const decodeText = (s: string) =>
  s
    .replace(/\\U\+([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[dD]/g, "°")
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[pP]/g, "±")
    .replace(/%%%/g, "%");

/** bajty → řetězec 1:1 (latin1) */
function latin1(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
}

/** Hladiny vypnuté v surovém ASCII DXF (záporná barva 62) → jejich barva ACI; acad-ts je při čtení zapne a barvu ztratí. */
export function dxfOffLayers(text: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  let inLayer = false;
  let name = "";
  let color = 0;
  const flush = () => {
    if (inLayer && name && color < 0) out.set(name.toLowerCase(), -color);
  };
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    const val = lines[i + 1].trim();
    if (code === 0) {
      flush();
      inLayer = val === "LAYER";
      name = "";
      color = 0;
    } else if (inLayer && code === 2) name = val;
    else if (inLayer && code === 62) color = Number(val);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- soubory

export type DraftFileFormat = "dxf" | "dwg";

/** 2D model → DXF (text, výchozí verze R2018) */
export function draftToDxf(model: DraftModel, version: DwgVersion = "R2018"): string {
  const doc = draftToCad(model, version);
  let out = "";
  DxfWriter.writeToStream({ write: (s: string) => void (out += s) }, doc, false);
  return out;
}
/** 2D model → DWG (R2000–R2018) */
export function draftToDwg(model: DraftModel, version: DwgVersion = "R2018"): Uint8Array {
  return DwgWriter.writeToBuffer(draftToCad(model, version));
}

/** DXF / DWG → 2D model (formát podle přípony, jinak podle obsahu) */
export function draftFromFile(name: string, bytes: Uint8Array): { model: DraftModel; note: ImportNote; format: DraftFileFormat } {
  const isDwg = /\.dwg$/i.test(name) || String.fromCharCode(...bytes.subarray(0, 2)) === "AC";
  if (isDwg) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const r = cadToDraft(DwgReader.readFromStream(buf));
    return { ...r, format: "dwg" };
  }
  const isBinary = DxfReader.isBinaryStream(bytes, true);
  let data = bytes;
  let off = new Map<string, number>();
  if (!isBinary) {
    const raw = latin1(bytes);
    off = dxfOffLayers(raw);
    // DXF R2007+ je vždy v UTF-8 (bez ohledu na $DWGCODEPAGE) – acad-ts by čte podle kódové stránky
    const ver = /\$ACADVER\r?\n\s*1\r?\n\s*AC(\d{4})/.exec(raw)?.[1];
    if (ver && Number(ver) >= 1021) {
      const fixed = raw.replace(/(\$DWGCODEPAGE\r?\n\s*3\r?\n)[^\r\n]*/, "$1utf-8");
      if (fixed !== raw) data = Uint8Array.from(fixed, (ch) => ch.charCodeAt(0) & 255);
    }
  }
  const r = cadToDraft(DxfReader.readFromStream(data), off);
  return { ...r, format: "dxf" };
}

/** text poznámky importu („přeskočeno: MTEXT 3, DIMENSION 2“) */
export function importNoteText(n: ImportNote): string {
  const sk = Object.entries(n.skipped).map(([k, v]) => `${k} ${v}`);
  return sk.length ? tr("Načteno {0} entit, {1} hladin. Zatím nepřevedeno: {2}.", n.entities, n.layers, sk.join(", ")) : tr("Načteno {0} entit, {1} hladin.", n.entities, n.layers);
}


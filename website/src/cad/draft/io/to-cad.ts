/**
 * 2D model → dokument acad-ts (CadDocument) pro zápis DWG R2000–R2018 a DXF R2000–R2018 (ASCII i binární).
 *
 * Tabulky: hladiny (barva, typ, tloušťka, zap / zmrazení / zámek / tisk, popis, průhlednost), typy čar (vzory
 * i složené prvky ze zdroje), textové styly (písmo, velké písmo, výška, šířka, sklon), kótovací styly, registrované
 * aplikace. Bloky (i anonymní), rozvržení (papír, okraje, měřítko tisku) s výřezy, modelový prostor.
 * Entity: všechny druhy jádra a smluvní druhy balíků 2 a 3 (mtext, kóty všech druhů s blokem geometrie, odkaz,
 * šrafa se vzorem / přechodem, tolerance, vložení bloku s atributy / MINSERT, definice atributu, výřez) + entity,
 * které import převedl a nesou původní typ v `ext.dxf` (SOLID, TRACE, 3DFACE, POLYLINE 2D/3D).
 * Vlastnosti: hladina, barva ACI / pravá / ByLayer / ByBlock, typ čáry, tloušťka, měřítko čáry, průhlednost,
 * handle ze zdroje, XDATA ze zdroje + MNCAD (id entity a údaje bez obdoby v DXF).
 */
import {
  ACadVersion,
  AppId,
  Arc,
  AttachmentPointType,
  AttributeDefinition,
  AttributeEntity,
  AttributeFlags,
  BlockRecord,
  BlockTypeFlags,
  BoundaryPathFlags,
  CadDocument,
  Circle,
  Color,
  type Dimension,
  DimensionAligned,
  DimensionAngular2Line,
  DimensionAngular3Pt,
  DimensionArc,
  DimensionDiameter,
  DimensionLinear,
  DimensionOrdinate,
  DimensionRadius,
  DimensionStyle,
  Ellipse,
  type Entity,
  Face3D,
  GradientColor,
  Hatch,
  HatchBoundaryPath,
  HatchBoundaryPathArc,
  type HatchBoundaryPathEdge,
  HatchBoundaryPathEllipse,
  HatchBoundaryPathLine,
  HatchBoundaryPathPolyline,
  HatchBoundaryPathSpline,
  HatchGradientPattern,
  HatchPattern,
  HatchPatternLine,
  HatchPatternType,
  Insert,
  Layer,
  LayerFlags,
  Layout,
  Leader,
  LeaderCreationType,
  LeaderPathType,
  Line,
  LineType,
  LineTypeSegment,
  LineWeightType,
  LwPolyline,
  LwPolylineVertex,
  MeasurementUnits,
  MText,
  PaperMargin,
  PlotPaperUnits,
  PlotRotation,
  Point,
  Polyline2D,
  Polyline3D,
  Ray,
  Region,
  ScaledType,
  Seqend,
  Solid,
  Solid3D,
  Spline,
  TextEntity,
  TextHorizontalAlignment,
  TextStyle,
  TextVerticalAlignmentType,
  Tolerance,
  Transparency,
  type UnitsType,
  Vertex2D,
  Vertex3D,
  Viewport,
  ViewportStatusFlags,
  XLine,
  XY,
  XYZ,
} from "@node-projects/acad-ts";
import { tr } from "../../i18n";
import type { DDimension, DHatch, DLeader, DMText, DTolerance } from "../annot/types";
import { materializeDimStyles } from "../annot/dimstyle";
import { leaderText } from "../annot/kinds-annot";
import type { DAttDef, DAttrib, DInsert, DViewport } from "../layout/types";
import { hexRgb, nearestAci } from "../colors";
import type { DwgVersion } from "../../formats/dwg-versions";
import { kindOf, type KindCtx } from "../kinds";
import { textFrame } from "../kinds-core";
import { LAYER0, snapLineweight, type DArc, type DCircle, type DEllipse, type DLine, type DPoint, type DPolyline, type DRay, type DraftColor, type DraftDimStyle, type DraftEntity, type DraftLayout, type DraftLw, type DraftModel, type DSpline, type DText, type DXLine, type NewEntity, type TextHAlign, type TextVAlign, type Vec2 } from "../model";
import { UNITS } from "../units";
import { applyAcadPatches } from "./acad-patch";
import { encodeNonCp1250, geomKey, MNCAD_APP, rad } from "./common";
import { dimensionGeometry } from "./dimgeom";
import { patternLines } from "./hatchpat";
import type { HatchEdge, PatLine } from "./types";
import { writeXData, type XDataCtx } from "./xdata";

export const ACAD: Record<DwgVersion, ACadVersion> = {
  R2000: ACadVersion.AC1015,
  R2004: ACadVersion.AC1018,
  R2007: ACadVersion.AC1021,
  R2010: ACadVersion.AC1024,
  R2013: ACadVersion.AC1027,
  R2018: ACadVersion.AC1032,
};

export type ToCadOpts = { version?: DwgVersion; fmt: "dxf" | "dwg"; binary?: boolean };
export type ToCadResult = { doc: CadDocument; warnings: string[] };

/** kód DIMSTYLE proměnné (DXF) ← název pole modelu – pro přepsání stylu u kóty (XDATA ACAD DSTYLE) */
export const DIMVAR_CODE: Record<string, number> = {
  dimpost: 3, dimscale: 40, dimasz: 41, dimexo: 42, dimdli: 43, dimexe: 44, dimrnd: 45, dimtp: 47, dimtm: 48,
  dimtol: 71, dimlim: 72, dimtih: 73, dimtoh: 74, dimse1: 75, dimse2: 76, dimtad: 77, dimzin: 78, dimazin: 79,
  dimtxt: 140, dimcen: 141, dimlfac: 144, dimtfac: 146, dimgap: 147, dimtofl: 172, dimclrd: 176, dimclre: 177,
  dimclrt: 178, dimadec: 179, dimdec: 271, dimaunit: 275, dimdsep: 278, dimjust: 280, dimsd1: 281, dimsd2: 282,
  dimlwd: 371, dimlwe: 372,
};

const xyz = (p: Vec2, z = 0) => new XYZ(p[0], p[1], z);
const xy = (p: Vec2) => new XY(p[0], p[1]);

export function cadColor(c: DraftColor | undefined): Color {
  if (c === undefined || c === "ByLayer") return Color.byLayer;
  if (c === "ByBlock") return Color.byBlock;
  if (typeof c === "number") return c >= 1 && c <= 255 ? new Color(c) : Color.byLayer;
  const rgb = hexRgb(c);
  return rgb ? new Color(rgb[0], rgb[1], rgb[2]) : Color.byLayer;
}
/**
 * Barva pro zápis: DWG – acad-ts zapisuje pravou barvu s prohozeným R a B (čte správně podle specifikace
 * 0xC2RRGGBB), proto se mu předá prohozená; R2000 pravé barvy nezná – nejbližší ACI (pravá zůstane v MNCAD JSON).
 */
function colorOut(ctx: Ctx, c: DraftColor | undefined): Color {
  if (typeof c !== "string" || c === "ByLayer" || c === "ByBlock") return cadColor(c);
  const rgb = hexRgb(c);
  if (!rgb) return Color.byLayer;
  if (ctx.ver < ACadVersion.AC1018) return new Color(nearestAci(rgb));
  return ctx.fmt === "dwg" ? new Color(rgb[2], rgb[1], rgb[0]) : new Color(rgb[0], rgb[1], rgb[2]);
}
const isTrue = (c: DraftColor | undefined) => typeof c === "string" && c.startsWith("#");
export function cadLw(lw: DraftLw | undefined): LineWeightType {
  if (lw === undefined || lw === "ByLayer") return LineWeightType.ByLayer;
  if (lw === "ByBlock") return LineWeightType.ByBlock;
  if (lw === "Default") return LineWeightType.Default;
  return Math.round(snapLineweight(lw) * 100) as LineWeightType;
}
/** průhlednost 0–90 % → hodnota DXF 440 (alfa 0–255 + příznak 0x02000000) */
const cadTransparency = (t: number) => new Transparency(Math.max(0, Math.min(90, Math.round(t))));

const H: Record<TextHAlign, TextHorizontalAlignment> = { left: TextHorizontalAlignment.Left, center: TextHorizontalAlignment.Center, right: TextHorizontalAlignment.Right, aligned: TextHorizontalAlignment.Aligned, middle: TextHorizontalAlignment.Middle, fit: TextHorizontalAlignment.Fit };
const V: Record<TextVAlign, TextVerticalAlignmentType> = { baseline: TextVerticalAlignmentType.Baseline, bottom: TextVerticalAlignmentType.Bottom, middle: TextVerticalAlignmentType.Middle, top: TextVerticalAlignmentType.Top };

type Ctx = {
  model: DraftModel;
  kctx: KindCtx;
  doc: CadDocument;
  ver: ACadVersion;
  fmt: "dxf" | "dwg";
  enc: (s: string) => string;
  layers: Map<string, Layer>;
  lts: Map<string, LineType>;
  styles: Map<string, TextStyle>;
  dimStyles: Map<string, DimensionStyle>;
  blocks: Map<string, BlockRecord>;
  anon: number;
  warnings: Set<string>;
  xctx: XDataCtx;
  /** entity podle id (asociativita odkazu, hranice šrafy) */
  byId: Map<string, Entity>;
  metric: boolean;
};

/** 2D model → dokument acad-ts */
export function draftToCad(model0: DraftModel, opts: ToCadOpts): ToCadResult {
  applyAcadPatches();
  // kótovací styly se všemi proměnnými (ISO-25 …) – jinak by výkres dostal jen palcový „Standard“ knihovny acad-ts
  // (DIMTXT 0,18) a kóty nakreslené po znovuotevření by byly drobné; metrický výkres proto vždy s ISO-25 (balík annot)
  const model = model0.vars.measurement !== 0 || model0.entities.some((e) => e.type === "dimension") || model0.dimStyles?.length ? materializeDimStyles(model0) : model0;
  const version = opts.version ?? "R2018";
  const ver = ACAD[version] ?? ACadVersion.AC1032;
  const doc = new CadDocument(ver, true);
  const unicode = ver >= ACadVersion.AC1021;
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
  h.textHeightDefault = v.textsize;
  h.codePage = unicode ? "ANSI_1252" : "ANSI_1250";
  try {
    // PSLTSCALE (balík layout): 1 = vzor čar ve výřezech v mm papíru, 0 = v jednotkách modelu
    (h as unknown as { paperSpaceLineTypeScaling: number }).paperSpaceLineTypeScaling = v.psltscale === 0 ? 0 : 1;
  } catch {
    /* starší knihovna */
  }
  // ostatní hlavička ze zdroje (jen jednoduché hodnoty, které knihovna zná)
  for (const [k, val] of Object.entries(model.ext?.header ?? {})) {
    try {
      const cur = (h as unknown as Record<string, unknown>)[k];
      if (cur !== undefined && typeof cur === typeof val) (h as unknown as Record<string, unknown>)[k] = val;
    } catch {
      /* jen ke čtení */
    }
  }
  const ctx: Ctx = {
    model,
    kctx: { model },
    doc,
    ver,
    fmt: opts.fmt,
    // R2007+ Unicode; starší DWG a binární DXF kódují řetězce cp1250 – znaky mimo ni jako \U+XXXX
    // (ASCII DXF před R2007 kóduje cp1250 až files.ts po celém textu)
    enc: unicode || (opts.fmt === "dxf" && !opts.binary) ? (s) => s : encodeNonCp1250,
    layers: new Map(),
    lts: new Map(),
    styles: new Map(),
    dimStyles: new Map(),
    blocks: new Map(),
    anon: 1,
    warnings: new Set(),
    xctx: { appId: () => null, layerHandle: () => 0 },
    byId: new Map(),
    metric: v.measurement === 1,
  };
  // registrované aplikace XDATA
  const apps = new Map<string, AppId>();
  ctx.xctx = {
    appId: (name) => {
      const k = name.toUpperCase();
      let a = apps.get(k) ?? doc.appIds!.tryGetValue(name) ?? null;
      if (!a) {
        if (!/^[A-Za-z0-9_$\-]{1,255}$/.test(name)) return null;
        a = new AppId(name);
        doc.appIds!.add(a);
      }
      apps.set(k, a);
      return a;
    },
    layerHandle: (name) => ctx.layers.get(name)?.handle ?? ctx.layers.get(LAYER0)?.handle ?? 0,
  };
  ctx.xctx.appId(MNCAD_APP);
  for (const a of model.ext?.appIds ?? []) ctx.xctx.appId(a);
  writeLinetypes(ctx);
  writeLayers(ctx);
  writeTextStyles(ctx);
  writeDimStyles(ctx);
  // údaje výkresu bez obdoby v hlavičce acad-ts: měřítko poznámek (CANNOSCALE = papír : skutečnost), PSLTSCALE
  const docJson: Record<string, unknown> = {};
  if (v.cannoscale !== undefined && Number.isFinite(v.cannoscale) && v.cannoscale > 0) docJson.cs = v.cannoscale;
  if (v.psltscale === 0) docJson.ps = 0;
  if (Object.keys(docJson).length && doc.modelSpace) writeXData(doc.modelSpace, ctx.xctx, undefined, { json: docJson });
  try {
    h.currentLayerName = v.clayer;
  } catch {
    /* hladina chybí – výchozí 0 */
  }
  try {
    if (v.textstyle && ctx.styles.has(v.textstyle.toLowerCase())) h.currentTextStyleName = ctx.styles.get(v.textstyle.toLowerCase())!.name;
    const ds = v.dimstyle && ctx.dimStyles.get(v.dimstyle.toLowerCase());
    if (ds) h.currentDimensionStyleName = ds.name;
  } catch {
    /* starší knihovna */
  }
  // bloky: nejdřív záznamy (vložení na ně odkazují i navzájem), pak obsah
  const blocks = (model.blocks ?? []).filter((b) => !(b.anonymous && /^\*D/i.test(b.name)));
  for (const b of blocks) {
    const rec = new BlockRecord(ctx.enc(b.name));
    rec.blockEntity.basePoint = xyz(b.base);
    if (b.desc) rec.blockEntity.comments = ctx.enc(b.desc);
    if (b.units) rec.units = UNITS[b.units].code as UnitsType;
    rec.isExplodable = b.explodable !== false;
    rec.canScale = !b.scaleUniformly;
    // příznaky bloku acad-ts nečte spolehlivě – MNCAD je vrátí přesně
    if (b.explodable === false || b.scaleUniformly) writeXData(rec, ctx.xctx, undefined, { json: { ...(b.explodable === false ? { nx: 1 } : {}), ...(b.scaleUniformly ? { su: 1 } : {}) } });
    if (b.anonymous) rec.blockFlags = (rec.blockFlags ?? 0) | BlockTypeFlags.Anonymous;
    try {
      doc.blockRecords!.add(rec);
      ctx.blocks.set(b.name, rec);
    } catch (e) {
      ctx.warnings.add(tr("blok {0}: {1}", b.name, (e as Error).message));
    }
  }
  for (const b of blocks) {
    const rec = ctx.blocks.get(b.name);
    if (rec) addEntities(ctx, b.entities, rec);
  }
  // rozvržení
  writeLayouts(ctx);
  addEntities(ctx, model.entities, doc.modelSpace!);
  // objekty, které model jen uchovává (REGION, 3DSOLID…)
  for (const r of model.ext?.raw ?? []) {
    if (!r.acis) continue;
    const owner = r.space === "model" ? doc.modelSpace : spaceRecord(ctx, r.space);
    if (!owner) continue;
    try {
      const g = r.type === "REGION" ? new Region() : new Solid3D();
      g.acisData = Uint8Array.from(atob(r.acis), (ch) => ch.charCodeAt(0));
      if (r.acisVersion) g.modelerFormatVersion = r.acisVersion;
      g.layer = ctx.layers.get(r.layer) ?? ctx.layers.get(LAYER0)!;
      g.color = colorOut(ctx, r.color);
      owner.entities.add(g);
    } catch (e) {
      ctx.warnings.add(`${r.type}: ${(e as Error).message}`);
    }
  }
  return { doc, warnings: [...ctx.warnings] };
}

function spaceRecord(ctx: Ctx, space: string): BlockRecord | null {
  if (space.startsWith("block:")) return ctx.blocks.get(space.slice(6)) ?? null;
  if (space.startsWith("layout:")) return layoutRecords.get(ctx.doc)?.get(space.slice(7)) ?? null;
  return ctx.doc.modelSpace;
}
const layoutRecords = new WeakMap<CadDocument, Map<string, BlockRecord>>();

// ---------------------------------------------------------------- tabulky

function writeLinetypes(ctx: Ctx) {
  const { doc } = ctx;
  ctx.lts.set("continuous", doc.lineTypes!.tryGetValue("Continuous") ?? LineType.continuous);
  for (const lt of ctx.model.linetypes) {
    if (/^(continuous|bylayer|byblock)$/i.test(lt.name)) continue;
    const L = new LineType(ctx.enc(lt.name));
    L.description = ctx.enc(lt.desc ?? "");
    const segs = (lt.ext?.segments as { length: number; shape?: number; text?: string; style?: string; scale?: number; rotation?: number; offset?: Vec2; flags?: number }[] | undefined) ?? null;
    if (segs && segs.length === lt.pattern.length) {
      for (const sx of segs) {
        const s = new LineTypeSegment();
        s.length = sx.length;
        if (sx.flags) s.shapeFlags = sx.flags;
        if (sx.shape) s.shapeNumber = sx.shape;
        if (sx.text) s.text = sx.text;
        if (sx.scale) s.scale = sx.scale;
        if (sx.rotation) s.rotation = sx.rotation;
        if (sx.offset) s.offset = { x: sx.offset[0], y: sx.offset[1] };
        if (sx.style) s.style = doc.textStyles!.tryGetValue(sx.style) ?? null;
        L.addSegment(s);
      }
    } else
      for (const x of lt.pattern) {
        const s = new LineTypeSegment();
        s.length = x;
        L.addSegment(s);
      }
    try {
      doc.lineTypes!.add(L);
      ctx.lts.set(lt.name.toLowerCase(), L);
    } catch (e) {
      ctx.warnings.add(tr("typ čáry {0}: {1}", lt.name, (e as Error).message));
    }
  }
}
const ltOf = (ctx: Ctx, n: string | undefined): LineType | null => {
  if (!n || /^bylayer$/i.test(n)) return null;
  if (/^byblock$/i.test(n)) return ctx.doc.lineTypes!.tryGetValue("ByBlock") ?? LineType.byBlock;
  return ctx.lts.get(n.toLowerCase()) ?? null;
};

function writeLayers(ctx: Ctx) {
  const { doc } = ctx;
  for (const l of ctx.model.layers) {
    let L = doc.layers!.tryGetValue(ctx.enc(l.name)) ?? null;
    if (!L) {
      L = new Layer(ctx.enc(l.name));
      try {
        doc.layers!.add(L);
      } catch (e) {
        ctx.warnings.add(tr("hladina {0}: {1}", l.name, (e as Error).message));
        continue;
      }
    }
    L.color = typeof l.color === "number" ? new Color(Math.max(1, Math.min(255, l.color))) : colorOut(ctx, l.color);
    L.lineType = ltOf(ctx, l.linetype) ?? ctx.lts.get("continuous")!;
    L.lineWeight = l.lineweight === "Default" ? LineWeightType.Default : cadLw(l.lineweight);
    L.isOn = l.on;
    L.layerFlags = (l.frozen ? LayerFlags.Frozen : 0) | (l.locked ? LayerFlags.Locked : 0);
    L.plotFlag = l.plot;
    const xd = { ...((l.ext?.xdata as Record<string, [number, unknown][]>) ?? {}) };
    if (l.desc) xd.AcAecLayerStandard = [[1000, ""], [1000, ctx.enc(l.desc)]];
    if (l.transparency) xd.AcCmTransparency = [[1071, Transparency.toAlphaValue(cadTransparency(l.transparency))]];
    // MNCAD: pravá barva u R2000, vypnutá hladina (acad-ts ji v binárním DXF čte jako zapnutou a ztratí barvu)
    const lj: Record<string, unknown> = {};
    if (isTrue(l.color) && ctx.ver < ACadVersion.AC1018) lj.c = l.color;
    if (!l.on) {
      lj.off = 1;
      if (typeof l.color === "number") lj.oc = l.color;
    }
    writeXData(L, ctx.xctx, Object.keys(xd).length ? xd : undefined, Object.keys(lj).length ? { json: lj } : undefined);
    ctx.layers.set(l.name, L);
  }
  if (!ctx.layers.has(LAYER0)) ctx.layers.set(LAYER0, doc.layers!.tryGetValue("0")!);
}

function writeTextStyles(ctx: Ctx) {
  const { doc } = ctx;
  for (const s of ctx.model.textStyles) {
    let S = doc.textStyles!.tryGetValue(ctx.enc(s.name)) ?? null;
    if (!S) {
      S = new TextStyle(ctx.enc(s.name));
      try {
        doc.textStyles!.add(S);
      } catch (e) {
        ctx.warnings.add(tr("styl {0}: {1}", s.name, (e as Error).message));
        continue;
      }
    }
    S.filename = s.font;
    S.height = s.height;
    S.width = s.wf || 1;
    S.obliqueAngle = rad(s.oblique);
    const big = s.ext?.bigFont;
    if (typeof big === "string" && big) S.bigFontFilename = big;
    const fl = s.ext?.flags;
    if (typeof fl === "number") S.mirrorFlag = fl;
    ctx.styles.set(s.name.toLowerCase(), S);
  }
}
const styleOf = (ctx: Ctx, name: string | undefined) => ctx.styles.get((name ?? ctx.model.vars.textstyle ?? "Standard").toLowerCase()) ?? null;

/** pole kótovacího stylu modelu → vlastnosti DimensionStyle (acad-ts) */
function applyDimStyle(ctx: Ctx, D: DimensionStyle, s: Partial<DraftDimStyle>) {
  const set = <K extends keyof DimensionStyle>(k: K, val: DimensionStyle[K] | undefined) => {
    if (val !== undefined) (D as unknown as Record<string, unknown>)[k as string] = val;
  };
  set("scaleFactor", s.dimscale);
  set("textHeight", s.dimtxt);
  set("arrowSize", s.dimasz);
  set("extensionLineExtension", s.dimexe);
  set("extensionLineOffset", s.dimexo);
  set("dimensionLineIncrement", s.dimdli);
  set("dimensionLineGap", s.dimgap);
  set("decimalPlaces", s.dimdec);
  set("angularDecimalPlaces", s.dimadec);
  set("linearScaleFactor", s.dimlfac);
  set("textVerticalAlignment", s.dimtad as never);
  set("textHorizontalAlignment", s.dimjust as never);
  set("textInsideHorizontal", s.dimtih);
  set("textOutsideHorizontal", s.dimtoh);
  set("textOutsideExtensions", s.dimtofl);
  set("suppressFirstExtensionLine", s.dimse1);
  set("suppressSecondExtensionLine", s.dimse2);
  set("suppressFirstDimensionLine", s.dimsd1);
  set("suppressSecondDimensionLine", s.dimsd2);
  if (s.dimpost !== undefined) set("postFix", s.dimpost);
  set("zeroHandling", s.dimzin as never);
  set("angularZeroHandling", s.dimazin as never);
  set("angularUnit", s.dimaunit as never);
  if (s.dimdsep) set("decimalSeparator", s.dimdsep.slice(0, 1));
  set("generateTolerances", s.dimtol);
  set("limitsGeneration", s.dimlim);
  set("plusTolerance", s.dimtp);
  set("minusTolerance", s.dimtm);
  set("toleranceScaleFactor", s.dimtfac);
  set("centerMarkSize", s.dimcen);
  set("rounding", s.dimrnd);
  if (s.dimclrd !== undefined) D.dimensionLineColor = colorOut(ctx, s.dimclrd);
  if (s.dimclre !== undefined) D.extensionLineColor = colorOut(ctx, s.dimclre);
  if (s.dimclrt !== undefined) D.textColor = colorOut(ctx, s.dimclrt);
  if (s.dimlwd !== undefined) D.dimensionLineWeight = cadLw(s.dimlwd);
  if (s.dimlwe !== undefined) D.extensionLineWeight = cadLw(s.dimlwe);
  if (s.dimtxsty) {
    const st = styleOf(ctx, s.dimtxsty);
    if (st) D.style = st;
  }
}

function writeDimStyles(ctx: Ctx) {
  const { doc } = ctx;
  for (const s of ctx.model.dimStyles ?? []) {
    let D = doc.dimensionStyles!.tryGetValue(ctx.enc(s.name)) ?? null;
    if (!D) {
      D = new DimensionStyle(ctx.enc(s.name));
      try {
        doc.dimensionStyles!.add(D);
      } catch (e) {
        ctx.warnings.add(tr("kótovací styl {0}: {1}", s.name, (e as Error).message));
        continue;
      }
    }
    applyDimStyle(ctx, D, s);
    // anotativní styl (DIMANNO) – AutoCAD ho drží v rozšiřujícím slovníku, zde MNCAD XDATA
    if ((s as { dimanno?: boolean }).dimanno) writeXData(D, ctx.xctx, undefined, { json: { an: 1 } });
    ctx.dimStyles.set(s.name.toLowerCase(), D);
  }
}
const dimStyleEnt = (ctx: Ctx, name: string | undefined): DimensionStyle | null => {
  const n = (name ?? ctx.model.vars.dimstyle ?? "").toLowerCase();
  return ctx.dimStyles.get(n) ?? ctx.doc.dimensionStyles!.tryGetValue("Standard") ?? null;
};

// ---------------------------------------------------------------- rozvržení

function paperOf(l: DraftLayout) {
  const p = (l as DraftLayout & { paper?: { size: string; w: number; h: number; units: "mm" | "in"; landscape: boolean; margins: [number, number, number, number] } }).paper;
  return p ?? { size: "ISO_A4_(210.00_x_297.00_MM)", w: 297, h: 210, units: "mm" as const, landscape: true, margins: [5, 5, 5, 5] as [number, number, number, number] };
}

function writeLayouts(ctx: Ctx) {
  const { doc } = ctx;
  const map = new Map<string, BlockRecord>();
  layoutRecords.set(doc, map);
  const list = [...(ctx.model.layouts ?? [])].sort((a, b) => ((a as { order?: number }).order ?? 0) - ((b as { order?: number }).order ?? 0));
  // slovník rozvržení (nový dokument acad-ts ho nemá – bez něj by se rozvržení nezapsala)
  if (!doc.layouts) doc.updateCollections(true, true);
  const coll = doc.layouts!;
  const modelLayout = doc.modelSpace?.layout;
  if (modelLayout && ![...coll].includes(modelLayout)) coll.add(modelLayout);
  const first = doc.paperSpace?.layout ?? null;
  if (!list.length && first && ![...coll].includes(first)) coll.add(first);
  let n = 0;
  for (const l of list) {
    let L: Layout | null;
    let rec: BlockRecord | null;
    try {
      if (n === 0) {
        L = first;
        rec = doc.paperSpace;
        // název před vložením do slovníku (klíč slovníku = název)
        if (L) L.name = ctx.enc(l.name);
        if (L && ![...coll].includes(L)) coll.add(L);
      } else {
        rec = new BlockRecord(`*Paper_Space${n - 1}`);
        L = new Layout(ctx.enc(l.name));
        L.associatedBlock = rec;
        doc.blockRecords!.add(rec);
        coll.add(L);
      }
    } catch (e) {
      ctx.warnings.add(tr("rozvržení {0}: {1}", l.name, (e as Error).message));
      continue;
    }
    if (!L || !rec) continue;
    n++;
    L.tabOrder = n;
    const p = paperOf(l);
    // média: šířka ≤ výška, na šířku = otočení o 90°
    const w = Math.min(p.w, p.h);
    const hh = Math.max(p.w, p.h);
    L.paperSize = p.size;
    L.paperUnits = p.units === "in" ? PlotPaperUnits.Inches : PlotPaperUnits.Millimeters;
    L.paperWidth = p.w > p.h ? w : p.w;
    L.paperHeight = p.w > p.h ? hh : p.h;
    L.paperRotation = p.w > p.h ? PlotRotation.Degrees90 : PlotRotation.NoRotation;
    const m = new PaperMargin(p.margins[0], p.margins[1], p.margins[2], p.margins[3]);
    L.unprintableMargin = m;
    const plot = (l as { plot?: { scale?: number | "fit"; styleTable?: string } }).plot;
    if (plot?.styleTable) L.styleSheet = plot.styleTable;
    if (plot?.scale === "fit") L.scaledFit = ScaledType.ScaleToFit;
    else {
      const k = typeof plot?.scale === "number" && plot.scale > 0 ? plot.scale : 1;
      L.scaledFit = ScaledType.UserDefined;
      L.numeratorScale = 1;
      L.denominatorScale = 1 / k;
    }
    try {
      // papír v orientaci listu (paperViewport používá paperWidth/Height)
      const pw = p.w;
      const ph = p.h;
      const tmpW = L.paperWidth;
      const tmpH = L.paperHeight;
      L.paperWidth = pw;
      L.paperHeight = ph;
      L.updatePaperViewport();
      L.paperWidth = tmpW;
      L.paperHeight = tmpH;
    } catch {
      /* bez papírového výřezu */
    }
    map.set(l.id, rec);
    addEntities(ctx, l.entities, rec);
  }
}

// ---------------------------------------------------------------- entity

function addEntities(ctx: Ctx, list: DraftEntity[], owner: BlockRecord) {
  const later: [DraftEntity, Entity[]][] = [];
  for (const e of list) {
    let ents: Entity[];
    try {
      ents = toEntities(ctx, e);
    } catch (err) {
      ctx.warnings.add(`${e.type} ${e.id}: ${(err as Error).message}`);
      continue;
    }
    if (!ents.length) continue;
    for (const ent of ents) props(ctx, ent, e, ent === ents[0]);
    for (const ent of ents) {
      try {
        owner.entities.add(ent);
        if (ent instanceof Polyline2D || ent instanceof Polyline3D) registerVertices(ctx, ent);
        if (ent instanceof Insert && ent.attributes.length) registerAttributes(ctx, ent);
      } catch (err) {
        ctx.warnings.add(`${e.type} ${e.id}: ${(err as Error).message}`);
      }
    }
    ctx.byId.set(e.id, ents[0]);
    later.push([e, ents]);
  }
}

/**
 * Vrcholy staré POLYLINE (2D / 3D) + SEQEND musí být objekty dokumentu s handle – acad-ts je při vložení křivky
 * nezaregistruje a zápis DWG by odkázal na handle 0 (křivka bez vrcholů).
 */
function registerVertices(ctx: Ctx, P: Polyline2D | Polyline3D) {
  const add = (ctx.doc as unknown as { _addCadObject?: (o: unknown) => void })._addCadObject?.bind(ctx.doc);
  if (!add) return;
  for (const v of P.vertices) {
    (v as unknown as { owner: unknown }).owner = P;
    if (!v.document) add(v);
    v.layer = P.layer;
  }
  if (!P.vertices.seqend) {
    const sq = new Seqend();
    (sq as unknown as { owner: unknown }).owner = P;
    sq.layer = P.layer;
    P.vertices.seqend = sq;
    add(sq);
  }
}

/** atributy vložení + SEQEND jako objekty dokumentu (jinak je DWG nezapíše) */
function registerAttributes(ctx: Ctx, I: Insert) {
  const add = (ctx.doc as unknown as { _addCadObject?: (o: unknown) => void })._addCadObject?.bind(ctx.doc);
  if (!add) return;
  for (const a of I.attributes) {
    (a as unknown as { owner: unknown }).owner = I;
    if (!a.document) add(a);
  }
  if (!I.attributes.seqend) {
    const sq = new Seqend();
    (sq as unknown as { owner: unknown }).owner = I;
    sq.layer = I.layer;
    I.attributes.seqend = sq;
    add(sq);
  }
}

/** společné vlastnosti + handle + XDATA (MNCAD jen na hlavní entitě) */
function props(ctx: Ctx, ent: Entity, e: DraftEntity, main: boolean) {
  ent.layer = ctx.layers.get(e.layer) ?? ctx.layers.get(LAYER0)!;
  ent.color = colorOut(ctx, e.color);
  const lt = ltOf(ctx, e.linetype);
  if (lt) ent.lineType = lt;
  ent.lineWeight = cadLw(e.lineweight);
  if (e.ltscale && e.ltscale !== 1) ent.lineTypeScale = e.ltscale;
  if (e.transparency) ent.transparency = cadTransparency(e.transparency);
  if (!main) {
    const j = (ent as unknown as { __mncad?: Record<string, unknown> }).__mncad;
    if (j) writeXData(ent, ctx.xctx, undefined, { json: j });
    return;
  }
  if (e.ext?.invisible) ent.isInvisible = true;
  const hd = e.ext?.handle ? parseInt(e.ext.handle, 16) : 0;
  if (hd > 0 && !ctx.doc.getCadObject(hd)) ent.handle = hd;
  let json = (ent as unknown as { __mncad?: Record<string, unknown> }).__mncad;
  if (isTrue(e.color) && ctx.ver < ACadVersion.AC1018) json = { ...(json ?? {}), c: e.color };
  // anotativní poznámka (balík annot): velikost na papíře × měřítko poznámek
  if ((e as { annotative?: boolean }).annotative) json = { ...(json ?? {}), an: 1 };
  // rám křivky po Proložit / Spline (balík edit, PEDIT Vyrovnat ho vrátí) – AutoCAD ho drží ve SPLINE-fit POLYLINE
  if (e.ext?.pedit) json = { ...(json ?? {}), pe: e.ext.pedit };
  // DXF: acad-ts zapíše XDATA vložení až za ATTRIB/SEQEND (patřila by k SEQEND) – MNCAD jde na první atribut
  const firstAtt = ctx.fmt === "dxf" && ent instanceof Insert && ent.attributes.length ? ent.attributes[0] : null;
  writeXData(ent, ctx.xctx, e.ext?.xdata as Record<string, [number, unknown][]> | undefined, firstAtt ? undefined : { id: e.id, json });
  if (firstAtt) writeXData(firstAtt, ctx.xctx, undefined, { id: e.id, json });
}
const withJson = <T extends Entity>(ent: T, json: Record<string, unknown> | undefined): T => {
  if (json && Object.keys(json).length) (ent as unknown as { __mncad?: Record<string, unknown> }).__mncad = json;
  return ent;
};

/** entita modelu → entity acad-ts (první = hlavní; odkaz s textem = LEADER + MTEXT) */
function toEntities(ctx: Ctx, e: DraftEntity): Entity[] {
  const x = e.ext;
  const same = !!x?.key && x.key === geomKey(e);
  switch (e.type) {
    case "point":
      return [new Point(xyz((e as DPoint).p, x?.elev ?? 0))];
    case "line": {
      const l = e as DLine;
      const L = new Line(xyz(l.a, same ? x?.z?.[0] ?? 0 : 0), xyz(l.b, same ? x?.z?.[1] ?? 0 : 0));
      if (x?.thick) L.thickness = x.thick;
      return [L];
    }
    case "xline": {
      const X = new XLine();
      X.firstPoint = xyz((e as DXLine).p);
      X.direction = xyz((e as DXLine).dir);
      return [X];
    }
    case "ray": {
      const R = new Ray();
      R.startPoint = xyz((e as DRay).p);
      R.direction = xyz((e as DRay).dir);
      return [R];
    }
    case "circle": {
      const c = e as DCircle;
      const C = new Circle(xyz(c.c, x?.elev ?? 0), c.r);
      if (x?.thick) C.thickness = x.thick;
      return [C];
    }
    case "arc": {
      const a = e as DArc;
      const A = new Arc(xyz(a.c, x?.elev ?? 0), a.r, rad(a.a0), rad(a.a1));
      if (x?.thick) A.thickness = x.thick;
      return [A];
    }
    case "polyline":
      return [polylineEnt(ctx, e as DPolyline, same)];
    case "ellipse": {
      const el = e as DEllipse;
      const E = new Ellipse();
      E.center = xyz(el.c);
      E.majorAxisEndPoint = xyz(el.major);
      E.radiusRatio = el.ratio;
      E.startParameter = el.t0 === undefined ? 0 : rad(el.t0);
      E.endParameter = el.t1 === undefined ? 2 * Math.PI : rad(el.t1);
      return [E];
    }
    case "spline": {
      const s = e as DSpline;
      const S = new Spline();
      S.degree = s.degree;
      S.controlPoints = s.ctrl.map((p) => xyz(p));
      S.knots = [...s.knots];
      if (s.weights?.length) S.weights = [...s.weights];
      // DWG: s body proložení zapíše acad-ts jen proložení (bez řídicích bodů) – proložení jde do MNCAD JSON
      if (s.fit?.length && ctx.fmt === "dxf") S.fitPoints = s.fit.map((p) => xyz(p));
      if (s.closed) S.isClosed = true;
      return [withJson(S, s.fit?.length && ctx.fmt === "dwg" ? { fit: s.fit } : undefined)];
    }
    case "text": {
      const t = e as DText;
      // bez stylu = aktuální styl výkresu (jako v aplikaci); do souboru se zapíše a příznak ns ho při čtení vrátí
      return [withJson(textEnt(ctx, t, new TextEntity()), t.style ? undefined : { ns: 1 })];
    }
    case "mtext":
      return [withJson(mtextEnt(ctx, e as DMText), (e as DMText).style ? undefined : { ns: 1 })];
    case "dimension":
      return dimEnts(ctx, e as DDimension, same);
    case "leader":
      return leaderEnts(ctx, e as DLeader);
    case "hatch":
      return hatchEnts(ctx, e as DHatch, same);
    case "tolerance": {
      const t = e as DTolerance;
      const T = new Tolerance();
      T.insertionPoint = xyz(t.p);
      T.text = ctx.enc(t.s);
      T.direction = xyz([Math.cos(rad(t.rot ?? 0)), Math.sin(rad(t.rot ?? 0))]);
      const ds = dimStyleEnt(ctx, t.style);
      if (ds) T.style = ds;
      return [withJson(T, { h: t.h, ...(t.style ? { style: t.style } : { ns: 1 }) })];
    }
    case "insert":
      return insertEnts(ctx, e as DInsert);
    case "attdef": {
      const a = e as DAttDef;
      const A = new AttributeDefinition();
      A.tag = ctx.enc(a.tag);
      A.prompt = ctx.enc(a.prompt ?? "");
      textEnt(ctx, { ...a, type: "text", s: a.def ?? "" } as unknown as DText, A);
      A.flags = (a.invisible ? AttributeFlags.Hidden : 0) | (a.constant ? AttributeFlags.Constant : 0) | (a.verify ? AttributeFlags.Verify : 0) | (a.preset ? AttributeFlags.Preset : 0);
      return [withJson(A, a.style ? undefined : { ns: 1 })];
    }
    case "viewport":
      return [viewportEnt(ctx, e as DViewport)];
  }
  return otherKind(ctx, e as DraftEntity);
}

/** druh, který tento modul nezná (budoucí balík): rozložit, umí-li to, a zapsat jako anonymní blok */
function otherKind(ctx: Ctx, e: DraftEntity): Entity[] {
  const parts: NewEntity[] = kindOf(e)?.explode?.(e, ctx.kctx) ?? [];
  if (parts.length) return anonBlockInsert(ctx, parts, "*U");
  ctx.warnings.add(tr("druh {0} nelze zapsat", e.type));
  return [];
}

function polylineEnt(ctx: Ctx, p: DPolyline, same: boolean): Entity {
  const x = p.ext;
  const kind = same ? x?.dxf : undefined;
  if (kind === "SOLID" || kind === "TRACE") {
    // (zachová se i jako šrafa – viz hatchEnts); křivka s původním typem SOLID: rohy 1,2,4,3
    const q = p.pts;
    const S = new Solid(xyz(q[0]), xyz(q[1] ?? q[0]), xyz(q[3] ?? q[2] ?? q[0]), xyz(q[2] ?? q[0]));
    return S;
  }
  if (kind === "3DFACE" && p.pts.length >= 3) {
    const z = x?.z ?? [];
    const q = p.pts;
    const F = new Face3D();
    F.firstCorner = xyz(q[0], z[0] ?? 0);
    F.secondCorner = xyz(q[1], z[1] ?? 0);
    F.thirdCorner = xyz(q[2], z[2] ?? 0);
    F.fourthCorner = xyz(q[3] ?? q[2], z[3] ?? z[2] ?? 0);
    if (x?.edges) F.flags = x.edges;
    return F;
  }
  if (kind === "POLYLINE3D") {
    const z = x?.z ?? [];
    const P = new Polyline3D();
    for (let i = 0; i < p.pts.length; i++) P.vertices.push(new Vertex3D(xyz(p.pts[i], z[i] ?? 0)));
    P.isClosed = !!p.closed;
    return P;
  }
  if (kind === "POLYLINE") {
    const P = new Polyline2D();
    p.pts.forEach((pt, i) => {
      const V2 = new Vertex2D(xyz(pt));
      V2.bulge = p.bulges?.[i] ?? 0;
      const w = p.widths?.[i] ?? (p.width ? [p.width, p.width] : undefined);
      if (w) {
        V2.startWidth = w[0];
        V2.endWidth = w[1];
      }
      P.vertices.push(V2);
    });
    P.isClosed = !!p.closed;
    if (x?.elev) P.elevation = x.elev;
    return P;
  }
  const pl = new LwPolyline(
    p.pts.map((pt, i) => {
      const vtx = new LwPolylineVertex(new XY(pt[0], pt[1]));
      vtx.bulge = p.bulges?.[i] ?? 0;
      const w = p.widths?.[i];
      if (w) {
        vtx.startWidth = w[0];
        vtx.endWidth = w[1];
      }
      return vtx;
    }),
  );
  pl.isClosed = !!p.closed;
  if (p.width) pl.constantWidth = p.width;
  if (x?.elev) pl.elevation = x.elev;
  if (x?.thick) pl.thickness = x.thick;
  return pl;
}

function textEnt<T extends TextEntity>(ctx: Ctx, e: DText, t: T): T {
  const fr = textFrame(e, ctx.kctx);
  t.value = ctx.enc(e.s);
  t.height = e.h;
  t.rotation = rad(e.rot ?? 0);
  t.widthFactor = e.wf ?? 1;
  t.obliqueAngle = rad(e.oblique ?? 0);
  const st = styleOf(ctx, e.style);
  if (st) t.style = st;
  t.horizontalAlignment = H[e.halign ?? "left"];
  t.verticalAlignment = V[e.valign ?? "baseline"];
  // DXF: 10 = levý konec účaří, 11 = bod zarovnání (u Zarovnat / Přizpůsobit druhý bod)
  const two = e.halign === "aligned" || e.halign === "fit";
  t.insertPoint = xyz(two ? e.p : fr.s);
  t.alignmentPoint = xyz(two ? (e.p2 ?? e.p) : e.p);
  return t;
}

function mtextEnt(ctx: Ctx, e: DMText): MText {
  const M = new MText(ctx.enc(e.s));
  M.insertPoint = xyz(e.p);
  M.height = e.h;
  M.rectangleWidth = e.w ?? 0;
  M.attachmentPoint = (e.attach ?? 1) as AttachmentPointType;
  M.rotation = rad(e.rot ?? 0);
  const st = styleOf(ctx, e.style);
  if (st) M.style = st;
  if (e.lineSpacing) M.lineSpacing = e.lineSpacing;
  if (e.bg) {
    M.backgroundFillFlags = (e.bg.useBackground ? 3 : 1) as never;
    if (e.bg.color !== undefined) M.backgroundColor = colorOut(ctx, e.bg.color);
    if (e.bg.scale) M.backgroundScale = e.bg.scale;
  }
  return M;
}

/** anonymní blok s entitami (ve světových souřadnicích) + jeho vložení v počátku */
function anonBlock(ctx: Ctx, parts: NewEntity[], prefix: string): BlockRecord {
  let name = "";
  do name = `${prefix}${ctx.anon++}`;
  while (ctx.doc.blockRecords!.tryGetValue(name) || (ctx.model.blocks ?? []).some((b) => b.name === name));
  const rec = new BlockRecord(name);
  rec.blockFlags = (rec.blockFlags ?? 0) | BlockTypeFlags.Anonymous;
  ctx.doc.blockRecords!.add(rec);
  addEntities(
    ctx,
    parts.map((p, i) => ({ ...p, id: `${name}.${i}`, layer: p.layer ?? LAYER0, ...(p.color === undefined ? { color: "ByBlock" } : {}) }) as DraftEntity),
    rec,
  );
  // id podčástí do XDATA nepatří (nejsou entitami modelu)
  for (const ent of rec.entities) ent.extendedData.clear();
  return rec;
}
function anonBlockInsert(ctx: Ctx, parts: NewEntity[], prefix: string): Entity[] {
  const rec = anonBlock(ctx, parts, prefix);
  const I = new Insert();
  I.block = rec;
  I.insertPoint = new XYZ(0, 0, 0);
  return [I];
}

function dimEnts(ctx: Ctx, e: DDimension, same: boolean): Entity[] {
  // geometrie bloku: rozklad druhu (balík 2) > uložený blok ze zdroje (jen beze změny) > vlastní náhrada ISO-25
  let parts: NewEntity[] | null = null;
  try {
    parts = kindOf(e)?.explode?.(e, ctx.kctx) ?? null;
  } catch {
    parts = null;
  }
  let meas: number | undefined;
  if (!parts?.length && same && e.ext?.block) {
    const b = ctx.model.blocks?.find((x) => x.name === e.ext!.block);
    if (b) parts = b.entities.map((x) => ({ ...x }) as unknown as NewEntity);
  }
  if (!parts?.length) {
    const g = dimensionGeometry(e, ctx.model);
    parts = g.ents;
    meas = g.measurement;
  }
  const z: Vec2 = [0, 0];
  let d: Dimension;
  switch (e.kind) {
    case "linear": {
      const D = new DimensionLinear();
      D.firstPoint = xyz(e.p1 ?? z);
      D.secondPoint = xyz(e.p2 ?? z);
      D.definitionPoint = xyz(e.line ?? e.p2 ?? z);
      D.rotation = rad(e.rot ?? 0);
      d = D;
      break;
    }
    case "aligned": {
      const D = new DimensionAligned(xyz(e.p1 ?? z), xyz(e.p2 ?? z));
      D.definitionPoint = xyz(e.line ?? e.p2 ?? z);
      d = D;
      break;
    }
    case "radius": {
      const D = new DimensionRadius();
      D.definitionPoint = xyz(e.center ?? z);
      D.angleVertex = xyz(e.chord ?? z);
      d = D;
      break;
    }
    case "diameter": {
      const D = new DimensionDiameter();
      D.definitionPoint = xyz(e.far ?? z);
      D.angleVertex = xyz(e.chord ?? z);
      d = D;
      break;
    }
    case "angular": {
      const D = new DimensionAngular2Line();
      D.firstPoint = xyz(e.l1?.[0] ?? z);
      D.secondPoint = xyz(e.l1?.[1] ?? z);
      D.angleVertex = xyz(e.l2?.[0] ?? z);
      D.definitionPoint = xyz(e.l2?.[1] ?? z);
      D.dimensionArc = xyz(e.arc ?? z);
      d = D;
      break;
    }
    case "angular3": {
      const D = new DimensionAngular3Pt();
      D.angleVertex = xyz(e.vertex ?? z);
      D.firstPoint = xyz(e.p1 ?? z);
      D.secondPoint = xyz(e.p2 ?? z);
      D.definitionPoint = xyz(e.arc ?? z);
      d = D;
      break;
    }
    case "ordinate": {
      const D = new DimensionOrdinate();
      D.definitionPoint = xyz(e.origin ?? z);
      D.featureLocation = xyz(e.p1 ?? z);
      D.leaderEndpoint = xyz(e.p2 ?? z);
      D.isOrdinateTypeX = !!e.xAxis;
      d = D;
      break;
    }
    case "arc": {
      if (ctx.fmt === "dxf") {
        // ARC_DIMENSION acad-ts do DXF nezapíše: blok geometrie + MNCAD JSON (návrat přesně do kóty)
        const ins = anonBlockInsert(ctx, parts, "*D");
        return [withJson(ins[0], { dim: dimJson(e) })];
      }
      const D = new DimensionArc();
      const c = e.center ?? z;
      D.center = xyz(c);
      D.firstPoint = xyz(e.p1 ?? z);
      D.secondPoint = xyz(e.p2 ?? z);
      D.definitionPoint = xyz(e.arc ?? z);
      D.startAngle = Math.atan2((e.p1 ?? z)[1] - c[1], (e.p1 ?? z)[0] - c[0]);
      D.endAngle = Math.atan2((e.p2 ?? z)[1] - c[1], (e.p2 ?? z)[0] - c[0]);
      d = D;
      break;
    }
    default:
      ctx.warnings.add(tr("kóta {0}: neznámý druh {1}", e.id, String((e as { kind?: string }).kind)));
      return [];
  }
  const ds = dimStyleEnt(ctx, e.style);
  if (ds) d.style = ds;
  if (e.text !== undefined) d.text = ctx.enc(e.text);
  if (e.textRot) d.textRotation = ctx.fmt === "dxf" ? e.textRot : rad(e.textRot);
  const tp = e.textPos ?? textPosOf(parts);
  if (tp) d.textMiddlePoint = xyz(tp);
  if (e.textPos) d.isTextUserDefinedLocation = true;
  if (e.overrides && Object.keys(e.overrides).length) {
    const m = new Map<number, unknown>();
    for (const [k, val] of Object.entries(e.overrides)) {
      const code = DIMVAR_CODE[k];
      if (code === undefined || val === undefined) continue;
      if (typeof val === "boolean") m.set(code, val ? 1 : 0);
      else if (k === "dimclrd" || k === "dimclre" || k === "dimclrt") m.set(code, typeof val === "number" ? val : 256);
      else if (k === "dimlwd" || k === "dimlwe") m.set(code, cadLw(val as DraftLw));
      else m.set(code, val);
    }
    try {
      d.setStyleOverrideMap(m);
    } catch {
      /* nepodporované přepsání */
    }
  }
  // směr osy X souřadnicové kóty (DXF 51 / DWG v radiánech); přesně zpět přes MNCAD
  if (e.hdir) d.horizontalDirection = rad(e.hdir);
  const rec = anonBlock(ctx, parts, "*D");
  d.block = rec;
  if (meas !== undefined && !Number.isFinite(meas)) ctx.warnings.add(tr("kóta {0}: neplatná hodnota", e.id));
  const dj: Record<string, unknown> = {};
  if (e.overrides && Object.keys(e.overrides).length) dj.ov = e.overrides;
  if (e.hdir) dj.hd = e.hdir;
  return [withJson(d, Object.keys(dj).length ? dj : undefined)];
}
const dimJson = (e: DDimension): Record<string, unknown> => {
  const o: Record<string, unknown> = { ...e };
  for (const k of ["id", "layer", "color", "linetype", "lineweight", "ltscale", "transparency", "ext"]) delete o[k];
  return o;
};
const textPosOf = (parts: NewEntity[]): Vec2 | null => {
  const t = parts.find((p) => p.type === "text" || p.type === "mtext") as { p: Vec2 } | undefined;
  return t?.p ?? null;
};

function leaderEnts(ctx: Ctx, e: DLeader): Entity[] {
  const L = new Leader();
  L.vertices = e.pts.map((p) => xyz(p));
  L.pathType = e.spline ? LeaderPathType.Spline : LeaderPathType.StraightLineSegments;
  L.arrowHeadEnabled = e.arrow !== "_NONE";
  const ds = dimStyleEnt(ctx, undefined);
  if (ds) L.style = ds;
  const json: Record<string, unknown> = {};
  if (e.arrow) json.arrow = e.arrow;
  if (e.arrowSize) json.arrowSize = e.arrowSize;
  if (e.dogleg !== undefined) json.dogleg = e.dogleg;
  if (e.style) json.style = e.style;
  if (e.ext?.dxf === "MULTILEADER") json.ml = 1;
  if (!e.text) {
    L.creationType = LeaderCreationType.CreatedWithoutAnnotation;
    return [withJson(L, json)];
  }
  const last = e.pts[e.pts.length - 1] ?? [0, 0];
  // bez uložené polohy textu: poloha, výška a připojení podle vykreslení balíku annot (zalomení, měřítko poznámek)
  let lt: ReturnType<typeof leaderText> = null;
  if (!e.textPos) {
    try {
      lt = leaderText(e, ctx.kctx);
    } catch {
      lt = null;
    }
  }
  const M = lt
    ? mtextEnt(ctx, { type: "mtext", id: "", layer: e.layer, p: lt.p, h: lt.h, w: 0, s: e.text, attach: lt.attach } as DMText)
    : mtextEnt(ctx, { type: "mtext", id: "", layer: e.layer, p: e.textPos ?? last, h: e.textH ?? 2.5, w: 0, s: e.text, attach: (e.textPos ?? last)[0] >= (e.pts[0]?.[0] ?? 0) ? 4 : 6 } as DMText);
  if (lt) {
    json.ntp = 1;
    if (e.textH !== undefined) json.th = e.textH;
  }
  L.creationType = LeaderCreationType.CreatedWithTextAnnotation;
  L.associatedAnnotation = M;
  withJson(M, { ld: e.id });
  L.textHeight = e.textH ?? 2.5;
  json.t = 1;
  if (e.textPos) json.tp = e.textPos;
  return [withJson(L, json), M];
}

function hatchEnts(ctx: Ctx, e: DHatch, same: boolean): Entity[] {
  // šrafa, která ve zdroji byla SOLID / TRACE (2D výplň 3–4 body) → zpět jako SOLID
  if (same && (e.ext?.dxf === "SOLID" || e.ext?.dxf === "TRACE") && e.loops.length === 1 && e.loops[0].pts.length >= 3 && e.loops[0].pts.length <= 4) {
    const q = e.loops[0].pts;
    return [new Solid(xyz(q[0]), xyz(q[1]), xyz(q[3] ?? q[2]), xyz(q[2]))];
  }
  if (!same && e.ext?.dxf === "SOLID" && e.loops.length === 1 && e.loops[0].pts.length <= 4 && e.loops[0].pts.length >= 3) {
    const q = e.loops[0].pts;
    return [new Solid(xyz(q[0]), xyz(q[1]), xyz(q[3] ?? q[2]), xyz(q[2]))];
  }
  const Hh = new Hatch();
  const solid = !!e.solid || /^solid$/i.test(e.pattern);
  Hh.isSolid = solid;
  Hh.pattern = new HatchPattern(solid ? "SOLID" : (e.pattern || "ANSI31").toUpperCase());
  Hh.patternType = solid ? HatchPatternType.SolidFill : HatchPatternType.PatternFill;
  Hh.patternAngle = rad(e.angle ?? 0);
  Hh.patternScale = e.scale || 1;
  Hh.isDouble = !!e.double;
  Hh.style = (e.islandStyle ?? 0) as never;
  e.loops.forEach((lp, i) => {
    const path = new HatchBoundaryPath();
    const orig = same ? e.ext?.loops?.[i] : undefined;
    if (orig?.length) {
      path.flags = (lp.outer ? BoundaryPathFlags.External : 0) | BoundaryPathFlags.Default;
      for (const ed of orig) path.edges.push(hatchEdge(ed));
    } else {
      path.flags = BoundaryPathFlags.Polyline | (lp.outer ? BoundaryPathFlags.External : 0);
      const pe = new HatchBoundaryPathPolyline();
      pe.vertices = lp.pts.map((p, k) => new XYZ(p[0], p[1], lp.bulges?.[k] ?? 0));
      pe.isClosed = true;
      path.edges.push(pe);
    }
    Hh.paths.push(path);
  });
  if (!solid) {
    let lines: PatLine[] | null = null;
    if (same && e.ext?.pat?.length) lines = e.ext.pat;
    if (!lines) lines = patternLines(e.pattern, e.scale || 1, e.angle ?? 0, ctx.metric);
    if (!lines) {
      ctx.warnings.add(tr("šrafa: vzor {0} není v knihovně – zapsán jako ANSI31", e.pattern));
      lines = patternLines("ANSI31", e.scale || 1, e.angle ?? 0, ctx.metric)!;
    }
    for (const l of lines) {
      const pl = new HatchPatternLine();
      pl.angle = rad(l.angle);
      pl.basePoint = xy(l.base);
      pl.offset = xy(l.offset);
      pl.dashLengths = [...l.dashes];
      Hh.pattern.lines.push(pl);
    }
  }
  if (e.gradient && ctx.ver > ACadVersion.AC1015) {
    const g = new HatchGradientPattern(e.gradient.name || "LINEAR");
    g.enabled = true;
    g.angle = rad(e.gradient.angle ?? 0);
    g.shift = e.gradient.shift ?? 0;
    const c1 = new GradientColor();
    c1.value = 0;
    c1.color = colorOut(ctx, e.gradient.color1);
    const c2 = new GradientColor();
    c2.value = 1;
    c2.color = colorOut(ctx, e.gradient.color2 ?? e.gradient.color1);
    g.isSingleColorGradient = e.gradient.color2 === undefined;
    g.colors = [c1, c2];
    Hh.gradientColor = g;
    if (!solid) Hh.pattern.lines.length = 0;
    Hh.isSolid = true;
  }
  const json: Record<string, unknown> = {};
  if (e.islandStyle) json.is = e.islandStyle;
  if (e.boundary?.length) json.b = e.boundary;
  if (e.origin) json.o = e.origin;
  if (e.gradient) json.g = e.gradient;
  return [withJson(Hh, json)];
}

function hatchEdge(ed: HatchEdge): HatchBoundaryPathEdge {
  switch (ed.t) {
    case "line": {
      const L = new HatchBoundaryPathLine();
      L.start = xy(ed.a);
      L.end = xy(ed.b);
      return L;
    }
    case "arc": {
      const A = new HatchBoundaryPathArc();
      A.center = xy(ed.c);
      A.radius = ed.r;
      A.startAngle = rad(ed.a0);
      A.endAngle = rad(ed.a1);
      A.counterClockWise = ed.ccw;
      return A;
    }
    case "ellipse": {
      const E = new HatchBoundaryPathEllipse();
      E.center = xy(ed.c);
      E.majorAxisEndPoint = xy(ed.major);
      E.minorToMajorRatio = ed.ratio;
      E.startAngle = rad(ed.a0);
      E.endAngle = rad(ed.a1);
      E.counterClockWise = ed.ccw;
      return E;
    }
    case "spline": {
      const S = new HatchBoundaryPathSpline();
      S.degree = ed.degree;
      S.knots = [...ed.knots];
      S.isRational = !!ed.weights?.length;
      S.isPeriodic = !!ed.periodic;
      S.controlPoints = ed.ctrl.map((p, i) => new XYZ(p[0], p[1], ed.weights?.[i] ?? 1));
      if (ed.fit?.length) S.fitPoints = ed.fit.map(xy);
      return S;
    }
  }
}

function insertEnts(ctx: Ctx, e: DInsert): Entity[] {
  const rec = ctx.blocks.get(e.block);
  if (!rec) {
    ctx.warnings.add(tr("vložení {0}: blok {1} neexistuje", e.id, e.block));
    return [];
  }
  // bez konstruktoru s blokem: ten by blok klonoval a doplnil atributy z definic (zde z modelu)
  const I = new Insert();
  I.block = rec;
  I.insertPoint = xyz(e.p);
  I.xScale = e.sx || 1;
  I.yScale = e.sy || 1;
  I.zScale = 1;
  I.rotation = rad(e.rot ?? 0);
  if ((e.cols ?? 1) > 1 || (e.rows ?? 1) > 1) {
    I.columnCount = e.cols ?? 1;
    I.rowCount = e.rows ?? 1;
    I.columnSpacing = e.colSpacing ?? 0;
    I.rowSpacing = e.rowSpacing ?? 0;
  }
  for (const a of e.attribs ?? []) I.attributes.push(attribEnt(ctx, a, e));
  const ns = (e.attribs ?? []).map((a, i) => (a.style ? -1 : i)).filter((i) => i >= 0);
  return [withJson(I, ns.length ? { ans: ns } : undefined)];
}
function attribEnt(ctx: Ctx, a: DAttrib, ins: DInsert): AttributeEntity {
  const A = new AttributeEntity();
  A.tag = ctx.enc(a.tag);
  textEnt(ctx, { type: "text", id: "", layer: a.layer ?? ins.layer, p: a.p, h: a.h, s: a.value ?? "", rot: a.rot, style: a.style, halign: a.halign, valign: a.valign, p2: a.p2, wf: a.wf } as DText, A);
  A.flags = a.invisible ? AttributeFlags.Hidden : AttributeFlags.None;
  A.layer = ctx.layers.get(a.layer ?? ins.layer) ?? ctx.layers.get(LAYER0)!;
  A.color = colorOut(ctx, a.color ?? ins.color);
  return A;
}

function viewportEnt(ctx: Ctx, e: DViewport): Viewport {
  const V2 = new Viewport();
  V2.center = xyz(e.c);
  V2.width = e.w;
  V2.height = e.h;
  V2.viewCenter = xy(e.viewCenter);
  V2.viewHeight = e.scale > 0 ? e.h / e.scale : e.h;
  V2.twistAngle = rad(e.twist ?? 0);
  let st = V2.status ?? 0;
  if (e.locked) st |= ViewportStatusFlags.ViewportZoomLocking;
  if (e.on === false) st |= ViewportStatusFlags.ViewportOff;
  if (e.clip?.length) st |= ViewportStatusFlags.NonRectangularClipping;
  V2.status = st;
  for (const n of e.frozenLayers ?? []) {
    const L = ctx.layers.get(n);
    if (L) V2.frozenLayers.push(L);
  }
  const json: Record<string, unknown> = { s: e.scale };
  if (e.twist) json.tw = e.twist;
  if (e.clip?.length) json.clip = e.clip;
  if (e.on === false) json.off = 1;
  if (e.locked) json.lk = 1;
  return withJson(V2, json);
}

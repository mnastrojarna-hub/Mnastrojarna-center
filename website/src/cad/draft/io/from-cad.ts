/**
 * Dokument acad-ts (CadDocument z DWG / DXF) → 2D model.
 *
 * Převádí tabulky (hladiny vč. popisu a průhlednosti, typy čar vč. složených prvků, textové a kótovací styly),
 * bloky (i anonymní – geometrie kót *D, tabulek *T), rozvržení s papírem, okraji a výřezy, modelový prostor.
 * Entity: bod, úsečka, přímka, polopřímka, LWPOLYLINE i stará POLYLINE (2D / 3D), kružnice, oblouk, elipsa, spline,
 * TEXT, MTEXT, DIMENSION všech druhů + ARC_DIMENSION, LEADER (s textem MTEXT), MULTILEADER, HATCH (cesty křivkou
 * i hranami – elipsy a splajny vzorkované, originál v ext), TOLERANCE, INSERT / MINSERT + ATTRIB, ATTDEF, VIEWPORT,
 * SOLID / TRACE (→ plná šrafa), 3DFACE (→ uzavřená křivka), WIPEOUT / IMAGE (→ rám), MLINE (→ křivky),
 * ACAD_TABLE (→ vložení bloku tabulky), REGION / 3DSOLID / BODY (→ uchované v ext.raw pro zápis zpět).
 * Entity s normálou −Z (zrcadlené OCS) se převedou do WCS. Co převést nejde, je spočítané v poznámce importu.
 */
import {
  Arc,
  AttributeDefinition,
  AttributeEntity,
  AttributeFlags,
  type BlockRecord,
  BoundaryPathFlags,
  CadBody,
  type CadDocument,
  CadWipeoutBase,
  Circle,
  type Color,
  DimensionAligned,
  DimensionAngular2Line,
  DimensionAngular3Pt,
  DimensionArc,
  DimensionDiameter,
  DimensionLinear,
  DimensionOrdinate,
  DimensionRadius,
  type DimensionStyle,
  Ellipse,
  type Entity,
  Face3D,
  Hatch,
  HatchBoundaryPathArc,
  HatchBoundaryPathEllipse,
  HatchBoundaryPathLine,
  HatchBoundaryPathPolyline,
  HatchBoundaryPathSpline,
  Insert,
  LayerFlags,
  Leader,
  LeaderPathType,
  Line,
  LineWeightType,
  LwPolyline,
  MeasurementUnits,
  MLine,
  MText,
  MultiLeader,
  Point,
  Polyline2D,
  Polyline3D,
  RasterImage,
  Ray,
  Region,
  Solid,
  Solid3D,
  Spline,
  TableEntity,
  TextEntity,
  Tolerance,
  Transparency,
  Viewport,
  ViewportStatusFlags,
  XLine,
} from "@node-projects/acad-ts";
import { tr } from "../../i18n";
import type { DDimension, DHatch, DLeader, DMText, DTolerance } from "../annot/types";
import type { DAttDef, DAttrib, DInsert, DViewport } from "../layout/types";
import { rgbHex } from "../colors";
import { newDraftModel } from "../doc";
import { LAYER0, snapLineweight, type DraftBlock, type DraftColor, type DraftDimStyle, type DraftEntity, type DraftLayer, type DraftLayout, type DraftLinetype, type DraftLw, type DraftModel, type DraftTextStyle, type NewEntity, type Vec2 } from "../model";
import { unitsFromCode } from "../units";
import { interpolateFit } from "../curves";
import { decodeMText, decodeText, deg, geomKey, H_ALIGN, norm360, unitV, V_ALIGN } from "./common";
import { DIMVAR_CODE } from "./to-cad";
import type { DraftRawObject, HatchEdge, PatLine, XRec } from "./types";
import { readXData } from "./xdata";

export type ImportNote = {
  /** převedené entity (všechny prostory) */
  entities: number;
  layers: number;
  blocks: number;
  layouts: number;
  /** nepřevedené objekty podle typu */
  skipped: Record<string, number>;
  /** převedené na jiný druh (SOLID → šrafa…) podle typu */
  converted: Record<string, number>;
  /** uchované bez zobrazení (REGION, 3DSOLID…) */
  kept: Record<string, number>;
  warnings: string[];
};

export type FromCadOpts = {
  fmt: "dxf" | "dwg";
  /** průběh převodu entit (0–1) */
  onProgress?: (f: number) => void;
};

const v2 = (p: { x: number; y: number }): Vec2 => [p.x, p.y];
const isZ = (p: { z?: number } | null | undefined) => !!p && Math.abs(p.z ?? 0) > 1e-12;
/** normála −Z (zrcadlené OCS): x se otočí */
const mirrored = (n: { x: number; y: number; z: number } | undefined | null) => !!n && n.z < -0.5 && Math.abs(n.x) < 1e-9 && Math.abs(n.y) < 1e-9;
const mx = (p: Vec2, m: boolean): Vec2 => (m ? [-p[0], p[1]] : p);

export function fromColor(c: Color | null | undefined): DraftColor | undefined {
  if (!c || c.isByLayer) return undefined;
  if (c.isByBlock) return "ByBlock";
  if (c.isTrueColor) return rgbHex([c.r, c.g, c.b]);
  return c.index >= 1 && c.index <= 255 ? c.index : undefined;
}
export function fromLw(w: LineWeightType): DraftLw | undefined {
  if (w === LineWeightType.ByLayer || w === undefined || w === null) return undefined;
  if (w === LineWeightType.ByBlock) return "ByBlock";
  if (w === LineWeightType.Default || w < 0) return "Default";
  return snapLineweight(w / 100);
}

/** hlavičkové proměnné, které se uchovají a zapíší zpět (jednoduché hodnoty) */
const HEADER_KEEP = [
  "angleBase", "angularDirection", "angularUnit", "linearUnitFormat", "attributeVisibility", "fillMode", "orthoMode",
  "regenMode", "filletRadius", "chamferDistance1", "chamferDistance2", "chamferLength", "chamferAngle", "traceWidthDefault",
  "polylineWidthDefault", "dimensionAssociativity", "splineType", "numberOfSplineSegments", "unitMode", "worldView",
  "paperSpaceLineTypeScaling", "pickStyle", "textQuality", "projectName", "lastSavedBy",
];

type Ctx = {
  doc: CadDocument;
  fmt: "dxf" | "dwg";
  note: ImportNote;
  layerNames: Set<string>;
  used: Set<string>;
  seq: number;
  /** handle → id entity modelu (hranice šraf) */
  handleId: Map<number, string>;
  /** šrafy s hranicí podle handle (doplní se na konci) */
  hatchBoundary: { e: DHatch; handles: number[] }[];
  /** MTEXT připojené k LEADER (v textu odkazu) */
  annotations: Set<number>;
  /** id z MNCAD XDATA (zabraná – nová id je přeskočí) */
  reserved: Set<string>;
  raw: DraftRawObject[];
  done: number;
  total: number;
  onProgress?: (f: number) => void;
  lastP: number;
  dimStyles: Map<string, DraftDimStyle>;
};
const inc = (r: Record<string, number>, k: string) => void (r[k] = (r[k] ?? 0) + 1);

/** dokument acad-ts → 2D model */
export function cadToDraft(doc: CadDocument, opts: FromCadOpts): { model: DraftModel; note: ImportNote } {
  const h = doc.header!;
  const base = newDraftModel({ units: unitsFromCode(Number(h.insUnits ?? 4)) });
  const note: ImportNote = { entities: 0, layers: 0, blocks: 0, layouts: 0, skipped: {}, converted: {}, kept: {}, warnings: [] };
  const header: Record<string, number | string | boolean> = {};
  for (const k of HEADER_KEEP) {
    try {
      const val = (h as unknown as Record<string, unknown>)[k];
      if (typeof val === "number" || typeof val === "string" || typeof val === "boolean") header[k] = val;
    } catch {
      /* proměnná chybí */
    }
  }
  let model: DraftModel = {
    ...base,
    vars: {
      ...base.vars,
      ltscale: h.lineTypeScale || 1,
      celtscale: h.currentEntityLinetypeScale || 1,
      prec: Number.isFinite(h.linearUnitPrecision) ? h.linearUnitPrecision : base.vars.prec,
      aprec: Number.isFinite(h.angularUnitPrecision) ? h.angularUnitPrecision : base.vars.aprec,
      pdmode: h.pointDisplayMode ?? 0,
      pdsize: h.pointDisplaySize ?? 0,
      mirrtext: h.mirrorText ? 1 : 0,
      lwdisplay: !!h.displayLineWeight,
      measurement: h.measurementUnits === MeasurementUnits.English ? 0 : 1,
      ...(h.textHeightDefault > 0 ? { textsize: h.textHeightDefault } : {}),
    },
    ext: { ...(base.ext ?? {}), source: { format: opts.fmt }, header },
  };
  // typy čar
  const linetypes: DraftLinetype[] = [{ name: "Continuous", desc: "Solid line", pattern: [] }];
  for (const lt of doc.lineTypes!) {
    if (/^(bylayer|byblock|continuous)$/i.test(lt.name)) continue;
    const segs = [...(lt.segments ?? [])];
    const complex = segs.some((s) => s.shapeNumber || s.text || s.shapeFlags);
    linetypes.push({
      name: decodeText(lt.name),
      desc: decodeText(lt.description ?? ""),
      pattern: segs.map((s) => s.length),
      ...(complex ? { ext: { segments: segs.map((s) => ({ length: s.length, flags: s.shapeFlags, shape: s.shapeNumber, text: s.text, style: s.style?.name, scale: s.scale, rotation: s.rotation, offset: [s.offset?.x ?? 0, s.offset?.y ?? 0] })) } } : {}),
    });
  }
  // hladiny
  const layers: DraftLayer[] = [];
  for (const L of doc.layers!) {
    const name = decodeText(L.name);
    const col = L.color;
    // vypnutá hladina (záporná barva 62) – acad-ts ji čte se znaménkem až s opravou v acad-patch.ts
    const color: number | string = col?.isTrueColor ? rgbHex([col.r, col.g, col.b]) : col && col.index >= 1 && col.index <= 255 ? col.index : 7;
    const ltn = L.lineType?.name ?? "Continuous";
    const flags = Number(L.layerFlags ?? 0);
    const lx = readXData(L);
    const xd = lx.xdata;
    const lc = lx.mncad?.json?.c;
    const loff = !!lx.mncad?.json?.off;
    const loc = lx.mncad?.json?.oc;
    let desc: string | undefined;
    let transparency: number | undefined;
    if (xd?.AcAecLayerStandard) {
      const s = xd.AcAecLayerStandard.filter((r) => r[0] === 1000).map((r) => String(r[1]));
      desc = s[1] ? decodeText(s[1]) : undefined;
      delete xd.AcAecLayerStandard;
    }
    if (xd?.AcCmTransparency) {
      const a = xd.AcCmTransparency.find((r) => r[0] === 1071)?.[1];
      if (typeof a === "number") {
        const t = Transparency.fromAlphaValue(a).value;
        if (t > 0 && t <= 90) transparency = t;
      }
      delete xd.AcCmTransparency;
    }
    layers.push({
      name,
      color: typeof lc === "string" && /^#[0-9a-f]{6}$/i.test(lc) ? lc : typeof loc === "number" && loc >= 1 && loc <= 255 ? loc : color,
      linetype: /^continuous$/i.test(ltn) ? "Continuous" : decodeText(ltn),
      lineweight: L.lineWeight === LineWeightType.Default || L.lineWeight < 0 ? "Default" : snapLineweight(L.lineWeight / 100),
      on: L.isOn && !loff,
      frozen: (flags & LayerFlags.Frozen) !== 0,
      locked: (flags & LayerFlags.Locked) !== 0,
      plot: L.plotFlag !== false,
      ...(desc ? { desc } : {}),
      ...(transparency ? { transparency } : {}),
      ...(xd && Object.keys(xd).length ? { ext: { xdata: xd } } : {}),
    });
  }
  if (!layers.some((l) => l.name === LAYER0)) layers.unshift(base.layers[0]);
  // chybějící typy čar hladin doplnit z výchozích (jinak Continuous)
  for (const l of layers) if (!linetypes.some((t) => t.name.toLowerCase() === l.linetype.toLowerCase())) {
    const lib = base.linetypes.find((t) => t.name.toLowerCase() === l.linetype.toLowerCase());
    if (lib) linetypes.push(lib);
    else l.linetype = "Continuous";
  }
  // textové styly
  const textStyles: DraftTextStyle[] = [];
  for (const S of doc.textStyles!) {
    if (!S.name) continue; // styly tvarů (SHX bez názvu)
    const ext: Record<string, unknown> = {};
    if (S.bigFontFilename) ext.bigFont = S.bigFontFilename;
    if (S.mirrorFlag) ext.flags = Number(S.mirrorFlag);
    textStyles.push({ name: decodeText(S.name), font: S.filename || "Arial", height: S.height || 0, wf: S.width || 1, oblique: deg(S.obliqueAngle || 0), ...(Object.keys(ext).length ? { ext } : {}) });
  }
  if (!textStyles.some((s) => /^standard$/i.test(s.name))) textStyles.unshift(base.textStyles[0]);
  // kótovací styly
  const dimStyles: DraftDimStyle[] = [];
  for (const D of doc.dimensionStyles!) dimStyles.push(fromDimStyle(D));
  model = { ...model, linetypes, layers, textStyles, ...(dimStyles.length ? { dimStyles } : {}) };
  const clayer = h.currentLayerName;
  if (clayer && layers.some((l) => l.name === clayer && !l.frozen)) model.vars = { ...model.vars, clayer };
  try {
    const ts = h.currentTextStyleName;
    if (ts && textStyles.some((s) => s.name === ts)) model.vars = { ...model.vars, textstyle: ts };
    const ds = h.currentDimensionStyleName;
    if (ds && dimStyles.some((s) => s.name === ds)) model.vars = { ...model.vars, dimstyle: ds };
  } catch {
    /* hlavička bez stylů */
  }
  note.layers = layers.length;
  // údaje výkresu z MNCAD (modelový prostor): měřítko poznámek, PSLTSCALE
  try {
    const dj = doc.modelSpace ? readXData(doc.modelSpace).mncad?.json : undefined;
    const ps = Number((h as unknown as { paperSpaceLineTypeScaling?: number }).paperSpaceLineTypeScaling);
    if (typeof dj?.cs === "number" && dj.cs > 0) model.vars = { ...model.vars, cannoscale: dj.cs };
    if (dj?.ps === 0 || ps === 0) model.vars = { ...model.vars, psltscale: 0 };
  } catch {
    /* bez údajů */
  }
  const ctx: Ctx = {
    doc,
    fmt: opts.fmt,
    note,
    layerNames: new Set(layers.map((l) => l.name)),
    used: new Set(),
    seq: 0,
    handleId: new Map(),
    hatchBoundary: [],
    annotations: new Set(),
    reserved: new Set(),
    raw: [],
    done: 0,
    total: 0,
    onProgress: opts.onProgress,
    lastP: 0,
    dimStyles: new Map(dimStyles.map((d) => [d.name.toLowerCase(), d])),
  };
  // počet entit pro průběh; id z MNCAD XDATA se zaberou předem (bloky se převádí před modelovým prostorem)
  const records = [...doc.blockRecords!];
  for (const r of records) {
    ctx.total += r.entities.count;
    for (const ent of r.entities) {
      const id = mncadId(ent);
      if (id) ctx.reserved.add(id);
    }
  }
  // bloky (bez modelového a papírových prostorů)
  const blocks: DraftBlock[] = [];
  const layoutBlocks = new Set<BlockRecord>();
  for (const l of doc.layouts!) if (l.associatedBlock) layoutBlocks.add(l.associatedBlock);
  for (const r of records) {
    if (layoutBlocks.has(r) || /^\*(model|paper)_space/i.test(r.name)) continue;
    const flags = Number(r.combinedFlags ?? 0);
    const bj = readXData(r).mncad?.json;
    const b: DraftBlock = {
      name: decodeText(r.name),
      base: v2(r.blockEntity?.basePoint ?? { x: 0, y: 0 }),
      entities: convertList(ctx, r.entities, `block:${r.name}`),
      ...(r.blockEntity?.comments ? { desc: decodeText(r.blockEntity.comments) } : {}),
      ...(r.units ? { units: unitsFromCode(Number(r.units)) } : {}),
      ...(bj?.nx ? { explodable: false } : {}),
      ...(bj?.su ? { scaleUniformly: true } : {}),
      ...(r.isAnonymous ? { anonymous: true } : {}),
    } as DraftBlock;
    if (flags & 4 /* XRef */) note.warnings.push(`xref:${r.name}`);
    blocks.push(b);
  }
  note.blocks = blocks.filter((b) => !(b as { anonymous?: boolean }).anonymous).length;
  // rozvržení
  const layouts: DraftLayout[] = [];
  let order = 0;
  for (const l of [...doc.layouts!].sort((a, b) => (a.tabOrder ?? 0) - (b.tabOrder ?? 0))) {
    if (!l.isPaperSpace || !l.associatedBlock) continue;
    order++;
    const rot90 = l.paperRotation === 1 || l.paperRotation === 3;
    const pw = l.paperWidth || 297;
    const ph = l.paperHeight || 210;
    const w = rot90 ? ph : pw;
    const hh = rot90 ? pw : ph;
    const m = l.unprintableMargin;
    const k = l.denominatorScale ? l.numeratorScale / l.denominatorScale : 1;
    const plotScale: number | "fit" = Number(l.scaledFit) === 0 ? "fit" : Math.abs(k - 1) < 1e-12 ? 1 : k;
    layouts.push({
      id: `L${order}`,
      name: decodeText(l.name),
      order,
      paper: { size: l.paperSize || `${w}x${hh}`, w, h: hh, units: l.paperUnits === 0 ? "in" : "mm", landscape: w > hh, margins: [m?.left ?? 0, m?.bottom ?? 0, m?.right ?? 0, m?.top ?? 0] },
      ...(l.styleSheet || plotScale !== 1 ? { plot: { ...(l.styleSheet ? { styleTable: l.styleSheet } : {}), scale: plotScale } } : {}),
      entities: convertList(ctx, l.associatedBlock.entities, `layout:L${order}`),
    } as DraftLayout);
  }
  note.layouts = layouts.length;
  const entities = convertList(ctx, doc.modelSpace!.entities, "model");
  // hranice šraf podle handle → id
  for (const hb of ctx.hatchBoundary) {
    const ids = hb.handles.map((x) => ctx.handleId.get(x)).filter((x): x is string => !!x);
    if (ids.length) hb.e.boundary = ids;
  }
  model = {
    ...model,
    seq: ctx.seq,
    entities,
    ...(blocks.length ? { blocks } : {}),
    ...(layouts.length ? { layouts } : {}),
    ext: { ...model.ext, ...(ctx.raw.length ? { raw: ctx.raw } : {}), appIds: [...doc.appIds!].map((a) => a.name).filter((n) => !/^(ACAD|MNCAD)$/i.test(n)) },
  };
  // seq za nejvyšší číslo id
  for (const id of ctx.used) {
    const n = /^e(\d+)$/.exec(id)?.[1];
    if (n) model.seq = Math.max(model.seq, Number(n));
  }
  return { model, note };
}

function fromDimStyle(D: DimensionStyle): DraftDimStyle {
  const s: DraftDimStyle & Record<string, unknown> = { name: decodeText(D.name) };
  if (readXData(D).mncad?.json?.an === 1) s.dimanno = true;
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && !(typeof v === "number" && !Number.isFinite(v))) s[k] = v;
  };
  put("dimscale", D.scaleFactor);
  put("dimtxt", D.textHeight);
  put("dimasz", D.arrowSize);
  put("dimexe", D.extensionLineExtension);
  put("dimexo", D.extensionLineOffset);
  put("dimdli", D.dimensionLineIncrement);
  put("dimgap", D.dimensionLineGap);
  put("dimdec", D.decimalPlaces);
  put("dimadec", D.angularDecimalPlaces);
  put("dimlfac", D.linearScaleFactor);
  put("dimtad", Number(D.textVerticalAlignment));
  put("dimjust", Number(D.textHorizontalAlignment));
  put("dimtih", D.textInsideHorizontal);
  put("dimtoh", D.textOutsideHorizontal);
  put("dimtofl", D.textOutsideExtensions);
  put("dimse1", D.suppressFirstExtensionLine);
  put("dimse2", D.suppressSecondExtensionLine);
  put("dimsd1", D.suppressFirstDimensionLine);
  put("dimsd2", D.suppressSecondDimensionLine);
  if (D.postFix) put("dimpost", D.postFix);
  put("dimzin", Number(D.zeroHandling));
  put("dimazin", Number(D.angularZeroHandling));
  put("dimaunit", Number(D.angularUnit));
  if (D.decimalSeparator) put("dimdsep", D.decimalSeparator);
  put("dimtol", D.generateTolerances);
  put("dimlim", D.limitsGeneration);
  put("dimtp", D.plusTolerance);
  put("dimtm", D.minusTolerance);
  put("dimtfac", D.toleranceScaleFactor);
  put("dimcen", D.centerMarkSize);
  if (D.rounding) put("dimrnd", D.rounding);
  const c1 = fromColor(D.dimensionLineColor);
  if (c1 !== undefined) put("dimclrd", c1);
  const c2 = fromColor(D.extensionLineColor);
  if (c2 !== undefined) put("dimclre", c2);
  const c3 = fromColor(D.textColor);
  if (c3 !== undefined) put("dimclrt", c3);
  const l1 = fromLw(D.dimensionLineWeight);
  if (l1 !== undefined && l1 !== "Default") put("dimlwd", l1);
  const l2 = fromLw(D.extensionLineWeight);
  if (l2 !== undefined && l2 !== "Default") put("dimlwe", l2);
  try {
    if (D.style?.name) put("dimtxsty", decodeText(D.style.name));
    for (const [k, b] of [["dimblk", D.arrowBlock], ["dimblk1", D.dimArrow1], ["dimblk2", D.dimArrow2]] as const) if (b?.name) put(k, b.name);
  } catch {
    /* bez odkazů */
  }
  return s;
}

function progress(ctx: Ctx) {
  ctx.done++;
  if (ctx.onProgress && ctx.total > 0 && ctx.done - ctx.lastP >= 2000) {
    ctx.lastP = ctx.done;
    ctx.onProgress(Math.min(1, ctx.done / ctx.total));
  }
}

/** seznam entit acad-ts → entity modelu (s id, vlastnostmi, ext) */
function convertList(ctx: Ctx, list: Iterable<Entity>, space: string): DraftEntity[] {
  const arr = [...list];
  // MTEXT připojené k odkazům (LEADER 340) – jejich text přejde do odkazu
  for (const ent of arr) if (ent instanceof Leader && ent.associatedAnnotation instanceof MText) ctx.annotations.add(ent.associatedAnnotation.handle);
  const out: DraftEntity[] = [];
  for (const ent of arr) {
    progress(ctx);
    if (ent instanceof MText && ctx.annotations.has(ent.handle)) continue;
    let res: NewEntity | NewEntity[] | null = null;
    try {
      res = fromEnt(ctx, ent, space);
    } catch (e) {
      ctx.note.warnings.push(`${ent.objectName}: ${(e as Error).message}`);
      res = null;
    }
    if (!res) continue;
    const list2 = Array.isArray(res) ? res : [res];
    list2.forEach((ne, i) => {
      const e = finish(ctx, ent, ne, i === 0);
      out.push(e);
      ctx.note.entities++;
    });
  }
  // text odkazu zapsaný naším exportem jako MTEXT s MNCAD {ld: id odkazu} (DWG odkaz na anotaci acad-ts nepropojí)
  const folded = new Set<DraftEntity>();
  for (const e of out) {
    const ld = (e as { __ld?: string }).__ld;
    if (!ld) continue;
    delete (e as { __ld?: string }).__ld;
    const L = out.find((x) => x.id === ld && x.type === "leader") as (DraftEntity & DLeader) | undefined;
    if (!L || L.text) continue;
    const m = e as unknown as DMText;
    L.text = m.s;
    // vypočtená poloha (MNCAD ntp): poloha i výška textu se znovu počítají z odkazu (výška ve výkrese = × měřítko poznámek)
    if (!(L as { __ntp?: number }).__ntp) {
      L.textPos = L.textPos ?? m.p;
      L.textH = m.h;
    }
    folded.add(e);
    ctx.used.delete(e.id);
  }
  for (const e of out) if ((e as { __ntp?: number }).__ntp) delete (e as { __ntp?: number }).__ntp;
  if (folded.size) {
    ctx.note.entities -= folded.size;
    return out.filter((e) => !folded.has(e));
  }
  return out;
}

/** id entity z MNCAD XDATA (bez převodu ostatních XDATA) */
function mncadId(ent0: Entity): string | undefined {
  try {
    const ent = ent0 instanceof Insert && ent0.attributes?.length && !ent0.extendedData?.size ? ent0.attributes[0] : ent0;
    const d = ent.extendedData;
    if (!d || d.size === 0) return undefined;
    const r = d.tryGetByName("MNCAD");
    const v = r.found ? r.value?.records[0]?.rawValue : undefined;
    return typeof v === "string" && /^e\d+$/.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** společné vlastnosti, id (MNCAD XDATA), handle, XDATA, otisk geometrie */
function finish(ctx: Ctx, ent: Entity, ne: NewEntity, main: boolean): DraftEntity {
  const lname = ent.layer?.name ? decodeText(ent.layer.name) : LAYER0;
  const layer = ctx.layerNames.has(lname) ? lname : LAYER0;
  const color = fromColor(ent.color);
  const ltn = ent.lineType?.name;
  const lw = fromLw(ent.lineWeight);
  const xd = main ? readXData(ent, (app) => app.toUpperCase() === "ACAD" && ent.objectName === "DIMENSION") : {};
  // MNCAD vložení s atributy je v DXF na prvním atributu (viz to-cad.ts)
  if (main && !xd.mncad && ent instanceof Insert && ent.attributes?.length) {
    const ax = readXData(ent.attributes[0]).mncad;
    if (ax) xd.mncad = ax;
  }
  let id = main ? xd.mncad?.id : undefined;
  if (!id || ctx.used.has(id) || !/^e\d+$/.test(id)) {
    do id = `e${++ctx.seq}`;
    while (ctx.used.has(id) || ctx.reserved.has(id));
  }
  ctx.used.add(id);
  if (main && ent.handle) ctx.handleId.set(ent.handle, id);
  const extIn = (ne as { ext?: DraftEntity["ext"] }).ext ?? {};
  const ext: DraftEntity["ext"] = { ...extIn };
  if (main && ent.handle) ext.handle = ent.handle.toString(16).toUpperCase();
  if (xd.xdata) ext.xdata = xd.xdata;
  if (ent.isInvisible) ext.invisible = true;
  let tr: number | undefined;
  try {
    const t = ent.transparency;
    if (t && !t.isByLayer && !t.isByBlock && t.value > 0) tr = t.value;
  } catch {
    tr = undefined;
  }
  const e = {
    ...ne,
    id,
    layer,
    ...(color !== undefined ? { color } : {}),
    ...(ltn && !/^bylayer$/i.test(ltn) ? { linetype: /^byblock$/i.test(ltn) ? "ByBlock" : /^continuous$/i.test(ltn) ? "Continuous" : decodeText(ltn) } : {}),
    ...(lw !== undefined ? { lineweight: lw } : {}),
    ...(ent.lineTypeScale && Math.abs(ent.lineTypeScale - 1) > 1e-12 ? { ltscale: ent.lineTypeScale } : {}),
    ...(tr ? { transparency: tr } : {}),
  } as DraftEntity;
  delete (e as { ext?: unknown }).ext;
  if (extIn.dxf || extIn.block || extIn.loops || extIn.pat || extIn.z) ext.key = geomKey(e);
  if (Object.keys(ext).length) e.ext = ext;
  // MNCAD JSON: údaje bez obdoby v DXF
  const j = xd.mncad?.json;
  if (j && main) applyJson(e, j);
  if (!main) {
    const jj = readXData(ent).mncad?.json;
    if (jj) applyJson(e, jj);
  }
  return e;
}

/** doplnění údajů z MNCAD JSON (zapsal je náš export) */
function applyJson(e: DraftEntity, j: Record<string, unknown>) {
  const o = e as unknown as Record<string, unknown>;
  if (typeof j.c === "string" && /^#[0-9a-f]{6}$/i.test(j.c)) o.color = j.c;
  if (j.ns) delete o.style;
  if (j.an === 1) o.annotative = true;
  if (j.pe && typeof j.pe === "object") o.ext = { ...((o.ext as object) ?? {}), pedit: j.pe };
  switch (e.type) {
    case "insert":
      if (Array.isArray(j.ans)) for (const i of j.ans) if (Array.isArray(o.attribs) && o.attribs[i]) delete (o.attribs[i] as { style?: string }).style;
      break;
    case "spline":
      if (Array.isArray(j.fit)) o.fit = j.fit;
      break;
    case "mtext":
      if (typeof j.ld === "string") o.__ld = j.ld;
      break;
    case "tolerance":
      if (typeof j.h === "number") o.h = j.h;
      if (typeof j.style === "string") o.style = j.style;
      break;
    case "leader":
      for (const k of ["arrow", "arrowSize", "dogleg", "style"]) if (j[k] !== undefined) o[k] = j[k];
      if (typeof j.th === "number") o.textH = j.th;
      if (j.tp) o.textPos = j.tp;
      // poloha textu se počítá (zapsaná poloha MTEXT je jen pro ostatní programy)
      else if (j.ntp) {
        delete o.textPos;
        o.__ntp = 1;
      }
      break;
    case "hatch":
      if (j.is === 1 || j.is === 2) o.islandStyle = j.is;
      if (Array.isArray(j.b)) o.boundary = j.b;
      if (j.o) o.origin = j.o;
      if (j.g) o.gradient = j.g;
      break;
    case "viewport":
      if (typeof j.s === "number") o.scale = j.s;
      if (typeof j.tw === "number") o.twist = j.tw;
      if (Array.isArray(j.clip)) o.clip = j.clip;
      if (j.off) o.on = false;
      if (j.lk) o.locked = true;
      break;
    case "dimension":
      if (j.ov && typeof j.ov === "object") o.overrides = j.ov;
      if (typeof j.hd === "number") o.hdir = j.hd;
      break;
  }
}

const textBase = (ent: TextEntity, m: boolean) => {
  const ha = H_ALIGN[Number(ent.horizontalAlignment) || 0] ?? "left";
  const va = V_ALIGN[Number(ent.verticalAlignment) || 0] ?? "baseline";
  const left = ha === "left" && va === "baseline";
  const two = ha === "aligned" || ha === "fit";
  const p = left || two ? v2(ent.insertPoint) : v2(ent.alignmentPoint);
  let rot = norm360(deg(ent.rotation || 0));
  if (m) rot = norm360(180 - rot);
  return {
    p: mx(p, m),
    h: ent.height,
    s: decodeText(ent.value ?? ""),
    ...(rot ? { rot } : {}),
    ...(ent.style?.name && !/^standard$/i.test(ent.style.name) ? { style: decodeText(ent.style.name) } : {}),
    ...(ha !== "left" ? { halign: ha } : {}),
    ...(va !== "baseline" ? { valign: va } : {}),
    ...(two ? { p2: mx(v2(ent.alignmentPoint), m) } : {}),
    ...(ent.widthFactor && Math.abs(ent.widthFactor - 1) > 1e-9 ? { wf: ent.widthFactor } : {}),
    ...(ent.obliqueAngle ? { oblique: deg(ent.obliqueAngle) } : {}),
  };
};

/** vydutí oblouku z úhlů [rad] a směru */
const bulgeOf = (a0: number, a1: number, ccw: boolean) => {
  let sweep = ccw ? a1 - a0 : a0 - a1;
  while (sweep < 0) sweep += 2 * Math.PI;
  while (sweep > 2 * Math.PI + 1e-12) sweep -= 2 * Math.PI;
  return (ccw ? 1 : -1) * Math.tan(sweep / 4);
};

function fromEnt(ctx: Ctx, ent: Entity, space: string): NewEntity | NewEntity[] | null {
  const name = ent.objectName ?? ent.constructor.name;
  if (ent instanceof Line) {
    const z = isZ(ent.startPoint) || isZ(ent.endPoint) ? { ext: { z: [ent.startPoint.z, ent.endPoint.z] } } : {};
    return { type: "line", a: v2(ent.startPoint), b: v2(ent.endPoint), ...(ent.thickness ? { ext: { ...("ext" in z ? z.ext : {}), thick: ent.thickness } } : z) } as NewEntity;
  }
  if (ent instanceof Arc) {
    const m = mirrored(ent.normal);
    let a0 = norm360(deg(ent.startAngle));
    let a1 = norm360(deg(ent.endAngle));
    if (m) [a0, a1] = [norm360(180 - a1), norm360(180 - a0)];
    return { type: "arc", c: mx(v2(ent.center), m), r: ent.radius, a0, a1, ...(ent.thickness ? { ext: { thick: ent.thickness } } : {}) } as NewEntity;
  }
  if (ent instanceof Circle) return { type: "circle", c: mx(v2(ent.center), mirrored(ent.normal)), r: ent.radius, ...(ent.thickness ? { ext: { thick: ent.thickness } } : {}) } as NewEntity;
  if (ent instanceof Point) return { type: "point", p: v2(ent.location) } as NewEntity;
  if (ent instanceof XLine) return { type: "xline", p: v2(ent.firstPoint), dir: unitV(v2(ent.direction)) } as NewEntity;
  if (ent instanceof Ray) return { type: "ray", p: v2(ent.startPoint), dir: unitV(v2(ent.direction)) } as NewEntity;
  if (ent instanceof LwPolyline) {
    const vs = ent.vertices;
    if (vs.length < 1) return null;
    const m = mirrored(ent.normal);
    const pts = vs.map((v) => mx(v2(v.location), m));
    const bulges = vs.map((v) => (m ? -(v.bulge ?? 0) : v.bulge ?? 0));
    const widths = vs.map((v) => [v.startWidth ?? 0, v.endWidth ?? 0] as [number, number]);
    const ext: Record<string, unknown> = {};
    if (ent.elevation) ext.elev = ent.elevation;
    if (ent.thickness) ext.thick = ent.thickness;
    return {
      type: "polyline",
      pts: pts.length === 1 ? [pts[0], pts[0]] : pts,
      ...(bulges.some((b) => Math.abs(b) > 1e-12) ? { bulges } : {}),
      ...(widths.some(([a, b]) => a > 0 || b > 0) ? { widths } : {}),
      ...(ent.constantWidth > 0 ? { width: ent.constantWidth } : {}),
      ...(ent.isClosed ? { closed: true } : {}),
      ...(Object.keys(ext).length ? { ext } : {}),
    } as NewEntity;
  }
  if (ent instanceof Polyline3D) {
    const vs = [...ent.vertices].filter((v) => "location" in v) as unknown as { location: { x: number; y: number; z: number }; flags: number }[];
    const use = vs.filter((v) => !(Number(v.flags) & 16));
    if (use.length < 2) return null;
    inc(ctx.note.converted, "POLYLINE3D");
    return { type: "polyline", pts: use.map((v) => v2(v.location)), ...(ent.isClosed ? { closed: true } : {}), ext: { dxf: "POLYLINE3D", z: use.map((v) => v.location.z) } } as NewEntity;
  }
  if (ent instanceof Polyline2D) {
    const vs = ([...ent.vertices] as unknown as { location: { x: number; y: number }; bulge: number; startWidth: number; endWidth: number; flags: number }[]).filter((v) => v && v.location);
    const use = vs.filter((v) => !(Number(v.flags) & 16));
    if (use.length < 1) return null;
    const m = mirrored(ent.normal);
    const bulges = use.map((v) => (m ? -(v.bulge ?? 0) : v.bulge ?? 0));
    const widths = use.map((v) => [v.startWidth || ent.startWidth || 0, v.endWidth || ent.endWidth || 0] as [number, number]);
    return {
      type: "polyline",
      pts: use.map((v) => mx(v2(v.location), m)),
      ...(bulges.some((b) => Math.abs(b) > 1e-12) ? { bulges } : {}),
      ...(widths.some(([a, b]) => a > 0 || b > 0) ? { widths } : {}),
      ...(ent.isClosed ? { closed: true } : {}),
      ext: { dxf: "POLYLINE", ...(ent.elevation ? { elev: ent.elevation } : {}) },
    } as NewEntity;
  }
  if (ent instanceof Ellipse) {
    const full = Math.abs(ent.endParameter - ent.startParameter - 2 * Math.PI) < 1e-9 || (ent.startParameter === 0 && ent.endParameter === 0);
    return { type: "ellipse", c: v2(ent.center), major: v2(ent.majorAxisEndPoint), ratio: ent.radiusRatio, ...(full ? {} : { t0: norm360(deg(ent.startParameter)), t1: norm360(deg(ent.endParameter)) }) } as NewEntity;
  }
  if (ent instanceof Spline) {
    const ctrl = ent.controlPoints.map(v2);
    if (ctrl.length < 2 || ent.knots.length !== ctrl.length + ent.degree + 1) {
      if (ent.fitPoints?.length >= 2) {
        // jen body proložení (ezdxf add_spline, některé převodníky): kubický splajn jimi procházející (tečny konců,
        // jsou-li zadané) – ne lomená čára; body proložení zůstanou v `fit`
        const fit = ent.fitPoints.map(v2);
        const tan = (t: { x: number; y: number } | undefined): Vec2 | undefined => (t && Math.hypot(t.x, t.y) > 1e-12 ? [t.x, t.y] : undefined);
        try {
          const closed = !!ent.isClosed;
          const s = interpolateFit(fit, closed ? { closed } : { tan0: tan(ent.startTangent), tan1: tan(ent.endTangent) });
          inc(ctx.note.converted, tr("SPLINE (jen body proložení → řídicí body)"));
          return { type: "spline", degree: s.degree, ctrl: s.ctrl, knots: s.knots, fit, ...(closed ? { closed: true } : {}) } as NewEntity;
        } catch {
          inc(ctx.note.converted, tr("SPLINE (jen body proložení → řídicí body)"));
          return { type: "polyline", pts: fit } as NewEntity;
        }
      }
      return null;
    }
    return { type: "spline", degree: ent.degree, ctrl, knots: [...ent.knots], ...(ent.weights?.length && ent.weights.some((w) => w !== 1) ? { weights: [...ent.weights] } : {}), ...(ent.fitPoints?.length ? { fit: ent.fitPoints.map(v2) } : {}), ...(ent.isClosed ? { closed: true } : {}) } as NewEntity;
  }
  if (ent instanceof AttributeDefinition) {
    const t = textBase(ent, mirrored((ent as unknown as { normal?: { x: number; y: number; z: number } }).normal));
    const f = Number(ent.flags ?? 0);
    const { s, ...rest } = t;
    return { type: "attdef", ...rest, tag: decodeText(ent.tag), prompt: decodeText(ent.prompt ?? ""), def: s, ...(f & AttributeFlags.Hidden ? { invisible: true } : {}), ...(f & AttributeFlags.Constant ? { constant: true } : {}), ...(f & AttributeFlags.Verify ? { verify: true } : {}), ...(f & AttributeFlags.Preset ? { preset: true } : {}) } as unknown as NewEntity;
  }
  if (ent instanceof AttributeEntity) return null; // patří k INSERT
  if (ent instanceof TextEntity) return { type: "text", ...textBase(ent, mirrored((ent as unknown as { normal?: { x: number; y: number; z: number } }).normal)) } as NewEntity;
  if (ent instanceof MText) return mtextOf(ent);
  if (ent instanceof DimensionLinear || ent instanceof DimensionAligned || ent instanceof DimensionRadius || ent instanceof DimensionDiameter || ent instanceof DimensionAngular2Line || ent instanceof DimensionAngular3Pt || ent instanceof DimensionOrdinate || ent instanceof DimensionArc) return dimOf(ctx, ent);
  if (ent instanceof Leader) return leaderOf(ent);
  if (ent instanceof MultiLeader) {
    inc(ctx.note.converted, "MULTILEADER");
    return multiLeaderOf(ent);
  }
  if (ent instanceof Hatch) return hatchOf(ctx, ent);
  if (ent instanceof Tolerance) {
    const st = ent.style;
    const hgt = (st?.textHeight || 2.5) * (st?.scaleFactor || 1);
    const r = norm360(deg(Math.atan2(ent.direction?.y ?? 0, ent.direction?.x ?? 1)));
    return { type: "tolerance", p: v2(ent.insertionPoint), s: decodeMText(ent.text ?? ""), h: hgt, ...(r ? { rot: r } : {}), ...(st?.name && !/^standard$/i.test(st.name) ? { style: decodeText(st.name) } : {}) } as DTolerance as unknown as NewEntity;
  }
  if (ent instanceof TableEntity) {
    if (!ent.block) return skip(ctx, name);
    inc(ctx.note.converted, "ACAD_TABLE");
    return { type: "insert", block: decodeText(ent.block.name), p: v2(ent.insertPoint), sx: 1, sy: 1, rot: 0, ext: { dxf: "ACAD_TABLE" } } as unknown as NewEntity;
  }
  if (ent instanceof Insert) return insertOf(ctx, ent);
  if (ent instanceof Viewport) {
    if (ent.representsPaper || !space.startsWith("layout:")) return null;
    return viewportOf(ent);
  }
  if (ent instanceof Solid) {
    const m = mirrored(ent.normal);
    const c = [ent.firstCorner, ent.secondCorner, ent.fourthCorner, ent.thirdCorner].map((p) => mx(v2(p), m));
    const pts = Math.hypot(c[2][0] - c[3][0], c[2][1] - c[3][1]) < 1e-12 ? c.slice(0, 3) : c;
    const kind = name === "TRACE" ? "TRACE" : "SOLID";
    inc(ctx.note.converted, kind);
    return { type: "hatch", pattern: "SOLID", solid: true, scale: 1, angle: 0, loops: [{ pts, outer: true }], ext: { dxf: kind } } as DHatch as unknown as NewEntity;
  }
  if (ent instanceof Face3D) {
    const c = [ent.firstCorner, ent.secondCorner, ent.thirdCorner, ent.fourthCorner];
    const same4 = Math.hypot(c[3].x - c[2].x, c[3].y - c[2].y, c[3].z - c[2].z) < 1e-12;
    const use = same4 ? c.slice(0, 3) : c;
    inc(ctx.note.converted, "3DFACE");
    return { type: "polyline", pts: use.map(v2), closed: true, ext: { dxf: "3DFACE", z: use.map((p) => p.z), ...(ent.flags ? { edges: Number(ent.flags) } : {}) } } as NewEntity;
  }
  if (ent instanceof CadWipeoutBase) {
    const isImg = ent instanceof RasterImage;
    const ins = v2(ent.insertPoint);
    const u = v2(ent.uVector);
    const v = v2(ent.vVector);
    const size = v2(ent.size ?? { x: 1, y: 1 });
    const W = (x: number, y: number): Vec2 => [ins[0] + u[0] * x + v[0] * y, ins[1] + u[1] * x + v[1] * y];
    let pts: Vec2[];
    const cb = ent.clipBoundaryVertices ?? [];
    if (cb.length >= 3) pts = cb.map((p) => W(p.x + 0.5, p.y + 0.5));
    else if (cb.length === 2) {
      const [a, b] = cb;
      pts = [W(a.x + 0.5, a.y + 0.5), W(b.x + 0.5, a.y + 0.5), W(b.x + 0.5, b.y + 0.5), W(a.x + 0.5, b.y + 0.5)];
    } else pts = [W(0, 0), W(size[0], 0), W(size[0], size[1]), W(0, size[1])];
    const kind = isImg ? "IMAGE" : "WIPEOUT";
    inc(ctx.note.converted, kind);
    let file: string | undefined;
    try {
      file = isImg ? (ent as RasterImage).definition?.fileName : undefined;
    } catch {
      file = undefined;
    }
    return { type: "polyline", pts, closed: true, ext: { dxf: kind, image: { ...(file ? { file } : {}), size, u, v, p: ins, kind } } } as NewEntity;
  }
  if (ent instanceof MLine) {
    const vs = ent.vertices ?? [];
    if (vs.length < 2) return skip(ctx, name);
    const n = vs[0].segments?.length ?? 0;
    const out: NewEntity[] = [];
    for (let i = 0; i < n; i++) {
      const pts = vs.map((vx) => {
        const d = vx.segments?.[i]?.parameters?.[0] ?? 0;
        return [vx.position.x + vx.miter.x * d, vx.position.y + vx.miter.y * d] as Vec2;
      });
      out.push({ type: "polyline", pts, ...(Number(ent.flags) & 2 ? { closed: true } : {}), ext: { dxf: "MLINE" } } as NewEntity);
    }
    if (!out.length) return skip(ctx, name);
    inc(ctx.note.converted, "MLINE");
    return out;
  }
  if (ent instanceof Region || ent instanceof Solid3D || ent instanceof CadBody) {
    try {
      const data = ent.acisData;
      if (data?.length) {
        let b = "";
        for (let i = 0; i < data.length; i += 0x8000) b += String.fromCharCode(...data.subarray(i, i + 0x8000));
        ctx.raw.push({ space, type: name, layer: ent.layer?.name ?? "0", ...(fromColor(ent.color) !== undefined ? { color: fromColor(ent.color) as number | string } : {}), handle: ent.handle.toString(16).toUpperCase(), acis: btoa(b), acisVersion: ent.modelerFormatVersion });
        inc(ctx.note.kept, name);
        return null;
      }
    } catch {
      /* bez dat ACIS */
    }
    return skip(ctx, name);
  }
  return skip(ctx, name);
}
const skip = (ctx: Ctx, name: string): null => {
  inc(ctx.note.skipped, name);
  return null;
};

function mtextOf(ent: MText): NewEntity {
  const bgf = Number(ent.backgroundFillFlags ?? 0);
  return {
    type: "mtext",
    p: v2(ent.insertPoint),
    h: ent.height,
    w: ent.rectangleWidth || 0,
    s: decodeMText(ent.value ?? ""),
    ...(ent.rotation ? { rot: norm360(deg(ent.rotation)) } : {}),
    ...(ent.style?.name && !/^standard$/i.test(ent.style.name) ? { style: decodeText(ent.style.name) } : {}),
    ...(ent.attachmentPoint && Number(ent.attachmentPoint) !== 1 ? { attach: Number(ent.attachmentPoint) } : {}),
    ...(ent.lineSpacing && Math.abs(ent.lineSpacing - 1) > 1e-9 ? { lineSpacing: ent.lineSpacing } : {}),
    ...(bgf & 1 ? { bg: { ...(bgf & 2 ? { useBackground: true } : {}), ...(fromColor(ent.backgroundColor) !== undefined ? { color: fromColor(ent.backgroundColor) } : {}), ...(ent.backgroundScale ? { scale: ent.backgroundScale } : {}) } } : {}),
  } as DMText as unknown as NewEntity;
}

function dimOf(ctx: Ctx, d: DimensionAligned | DimensionRadius | DimensionDiameter | DimensionAngular2Line | DimensionAngular3Pt | DimensionOrdinate | DimensionArc): NewEntity {
  const z = (p: { x: number; y: number }) => v2(p);
  let o: Partial<DDimension>;
  if (d instanceof DimensionLinear) o = { kind: "linear", p1: z(d.firstPoint), p2: z(d.secondPoint), line: z(d.definitionPoint), ...(d.rotation ? { rot: norm360(deg(d.rotation)) } : {}) };
  else if (d instanceof DimensionAligned) o = { kind: "aligned", p1: z(d.firstPoint), p2: z(d.secondPoint), line: z(d.definitionPoint) };
  else if (d instanceof DimensionRadius) o = { kind: "radius", center: z(d.definitionPoint), chord: z(d.angleVertex) };
  else if (d instanceof DimensionDiameter) o = { kind: "diameter", far: z(d.definitionPoint), chord: z(d.angleVertex) };
  else if (d instanceof DimensionAngular2Line) o = { kind: "angular", l1: [z(d.firstPoint), z(d.secondPoint)], l2: [z(d.angleVertex), z(d.definitionPoint)], arc: z(d.dimensionArc) };
  else if (d instanceof DimensionAngular3Pt) o = { kind: "angular3", vertex: z(d.angleVertex), p1: z(d.firstPoint), p2: z(d.secondPoint), arc: z(d.definitionPoint) };
  else if (d instanceof DimensionOrdinate) {
    o = { kind: "ordinate", origin: z(d.definitionPoint), p1: z(d.featureLocation), p2: z(d.leaderEndpoint), ...(d.isOrdinateTypeX ? { xAxis: true } : {}) };
    // směr osy X (51) – cizí soubory; náš export ho vrátí přesně z MNCAD
    const hd = Number(d.horizontalDirection);
    if (Number.isFinite(hd) && Math.abs(hd) > 1e-12) o.hdir = (hd * 180) / Math.PI;
  }
  else o = { kind: "arc", center: z(d.center), p1: z(d.firstPoint), p2: z(d.secondPoint), arc: z(d.definitionPoint) };
  const st = d.style?.name;
  const tr = d.textRotation ? (ctx.fmt === "dxf" ? d.textRotation : deg(d.textRotation)) : 0;
  let meas: number | undefined;
  try {
    meas = d.measurement;
  } catch {
    meas = undefined;
  }
  const ov: Record<string, unknown> = {};
  try {
    const m = d.getStyleOverrideMap();
    if (m) {
      const byCode = new Map(Object.entries(DIMVAR_CODE).map(([k, c]) => [c, k]));
      for (const [code, val] of m) {
        const k = byCode.get(Number(code));
        if (!k) continue;
        if (["dimtih", "dimtoh", "dimtofl", "dimse1", "dimse2", "dimsd1", "dimsd2", "dimtol", "dimlim"].includes(k)) ov[k] = !!val;
        else if (k === "dimlwd" || k === "dimlwe") {
          const lw = fromLw(Number(val) as LineWeightType);
          if (lw !== undefined) ov[k] = lw;
        } else ov[k] = val;
      }
    }
  } catch {
    /* bez přepsání */
  }
  const tp = d.isTextUserDefinedLocation ? z(d.textMiddlePoint) : undefined;
  return {
    type: "dimension",
    ...o,
    ...(st && !/^standard$/i.test(st) ? { style: decodeText(st) } : st ? { style: st } : {}),
    ...(tp ? { textPos: tp } : {}),
    ...(d.text ? { text: decodeMText(d.text) } : {}),
    ...(tr ? { textRot: tr } : {}),
    ...(Object.keys(ov).length ? { overrides: ov } : {}),
    ...(meas !== undefined && Number.isFinite(meas) ? { measurement: meas } : {}),
    ...(d.block?.name ? { ext: { block: decodeText(d.block.name) } } : {}),
  } as unknown as NewEntity;
}

function leaderOf(L: Leader): NewEntity {
  const pts = (L.vertices ?? []).map(v2);
  const a = L.associatedAnnotation;
  const out: Partial<DLeader> & { type: "leader" } = { type: "leader", pts };
  if (L.pathType === LeaderPathType.Spline) out.spline = true;
  if (!L.arrowHeadEnabled) out.arrow = "_NONE";
  if (a instanceof MText) {
    out.text = decodeMText(a.value ?? "");
    out.textPos = v2(a.insertPoint);
    out.textH = a.height;
  }
  return out as unknown as NewEntity;
}

function multiLeaderOf(M: MultiLeader): NewEntity[] {
  const c = M.contextData;
  const out: NewEntity[] = [];
  const roots = c?.leaderRoots ?? [];
  for (const r of roots) {
    for (const line of r.lines ?? []) {
      const pts = (line.points ?? []).map(v2);
      if (r.connectionPoint) pts.push(v2(r.connectionPoint));
      if (pts.length < 2) continue;
      out.push({ type: "leader", pts, ...(M.arrowheadSize ? { arrowSize: M.arrowheadSize } : {}), ...(M.landingDistance ? { dogleg: M.landingDistance } : {}), ext: { dxf: "MULTILEADER" } } as unknown as NewEntity);
    }
  }
  if (!out.length) out.push({ type: "leader", pts: [v2(c?.textLocation ?? { x: 0, y: 0 }), v2(c?.textLocation ?? { x: 0, y: 0 })], ext: { dxf: "MULTILEADER" } } as unknown as NewEntity);
  const first = out[0] as unknown as DLeader;
  if (c?.textLabel) {
    first.text = decodeMText(c.textLabel);
    first.textPos = v2(c.textLocation);
    if (c.textHeight) first.textH = c.textHeight;
  }
  return out;
}

function hatchOf(ctx: Ctx, H: Hatch): NewEntity {
  const loops: DHatch["loops"] = [];
  const origLoops: Record<number, HatchEdge[]> = {};
  const m = mirrored(H.normal);
  const boundaryHandles: number[] = [];
  H.paths.forEach((path, i) => {
    const outer = (path.flags & (BoundaryPathFlags.External | BoundaryPathFlags.Outermost)) !== 0;
    for (const be of path.entities ?? []) if (be?.handle) boundaryHandles.push(be.handle);
    const pts: Vec2[] = [];
    const bulges: number[] = [];
    let sampled = false;
    const edges: HatchEdge[] = [];
    for (const ed of path.edges) {
      if (ed instanceof HatchBoundaryPathPolyline) {
        for (const vx of ed.vertices) {
          pts.push(mx([vx.x, vx.y], m));
          bulges.push(m ? -(vx.z || 0) : vx.z || 0);
        }
      } else if (ed instanceof HatchBoundaryPathLine) {
        pts.push(mx(v2(ed.start), m));
        bulges.push(0);
        edges.push({ t: "line", a: v2(ed.start), b: v2(ed.end) });
      } else if (ed instanceof HatchBoundaryPathArc) {
        const c = v2(ed.center);
        const a0 = ed.startAngle;
        const a1 = ed.endAngle;
        // hrany oblouku: při ccw = false jsou úhly zrcadlené (DXF) – bod začátku je c + r·(cos a0, −sin a0)
        const ccw = ed.counterClockWise;
        const s0 = ccw ? a0 : -a0;
        const s1 = ccw ? a1 : -a1;
        pts.push(mx([c[0] + ed.radius * Math.cos(s0), c[1] + ed.radius * Math.sin(s0)], m));
        const b = bulgeOf(s0, s1, ccw);
        bulges.push(m ? -b : b);
        edges.push({ t: "arc", c, r: ed.radius, a0: deg(a0), a1: deg(a1), ccw });
      } else if (ed instanceof HatchBoundaryPathEllipse) {
        sampled = true;
        edges.push({ t: "ellipse", c: v2(ed.center), major: v2(ed.majorAxisEndPoint), ratio: ed.minorToMajorRatio, a0: deg(ed.startAngle), a1: deg(ed.endAngle), ccw: ed.counterClockWise });
        for (const p of ed.polygonalVertexes(48).slice(0, -1)) {
          pts.push(mx([p.x, p.y], m));
          bulges.push(0);
        }
      } else if (ed instanceof HatchBoundaryPathSpline) {
        sampled = true;
        edges.push({ t: "spline", degree: ed.degree, ctrl: ed.controlPoints.map(v2), knots: [...ed.knots], ...(ed.isRational ? { weights: ed.controlPoints.map((p) => p.z || 1) } : {}), ...(ed.fitPoints?.length ? { fit: ed.fitPoints.map(v2) } : {}), ...(ed.isPeriodic ? { periodic: true } : {}) });
        for (const p of ed.polygonalVertexes(64).slice(0, -1)) {
          pts.push(mx([p.x, p.y], m));
          bulges.push(0);
        }
      }
    }
    if (pts.length < 2) return;
    loops.push({ pts, ...(bulges.some((b) => Math.abs(b) > 1e-12) ? { bulges } : {}), ...(outer ? { outer: true } : {}) });
    if (sampled) origLoops[loops.length - 1] = edges;
    void i;
  });
  const grad = H.gradientColor;
  const gradient = grad?.enabled && grad.colors?.length ? { name: grad.name || "LINEAR", color1: fromColor(grad.colors[0]?.color) ?? 7, ...(grad.colors[1] && !grad.isSingleColorGradient ? { color2: fromColor(grad.colors[1].color) ?? 7 } : {}), ...(grad.angle ? { angle: deg(grad.angle) } : {}), ...(grad.shift ? { shift: grad.shift } : {}) } : undefined;
  const pat: PatLine[] = (H.pattern?.lines ?? []).map((l) => ({ angle: deg(l.angle), base: v2(l.basePoint), offset: v2(l.offset), dashes: [...l.dashLengths] }));
  const name = H.pattern?.name || (H.isSolid ? "SOLID" : "ANSI31");
  const e: DHatch = {
    type: "hatch",
    pattern: name.toUpperCase(),
    ...(H.isSolid && !gradient ? { solid: true } : {}),
    scale: H.patternScale || 1,
    angle: norm360(deg(H.patternAngle || 0)),
    loops,
    ...(H.style ? { islandStyle: Number(H.style) as 0 | 1 | 2 } : {}),
    ...(H.isDouble ? { double: true } : {}),
    ...(gradient ? { gradient: gradient as DHatch["gradient"] } : {}),
    ...(Object.keys(origLoops).length || pat.length ? { ext: { ...(Object.keys(origLoops).length ? { loops: origLoops } : {}), ...(pat.length ? { pat } : {}) } } : {}),
  } as unknown as DHatch;
  if (H.isAssociative && boundaryHandles.length) ctx.hatchBoundary.push({ e, handles: boundaryHandles });
  return e as unknown as NewEntity;
}

function insertOf(ctx: Ctx, I: Insert): NewEntity | null {
  const b = I.block;
  if (!b) return skip(ctx, "INSERT (bez bloku)");
  const m = mirrored(I.normal);
  let rot = norm360(deg(I.rotation || 0));
  let sx = I.xScale || 1;
  if (m) {
    rot = norm360(180 - rot);
    sx = -sx;
  }
  const attribs: DAttrib[] = [];
  for (const a of I.attributes ?? []) {
    if (!(a instanceof AttributeEntity)) continue;
    const t = textBase(a, m);
    const f = Number(a.flags ?? 0);
    const al = a.layer?.name ? decodeText(a.layer.name) : undefined;
    const ac = fromColor(a.color);
    attribs.push({
      tag: decodeText(a.tag),
      value: t.s,
      p: t.p,
      h: t.h,
      ...(t.rot ? { rot: t.rot } : {}),
      ...(t.style ? { style: t.style } : {}),
      ...(t.halign ? { halign: t.halign } : {}),
      ...(t.valign ? { valign: t.valign } : {}),
      ...(t.p2 ? { p2: t.p2 } : {}),
      ...(t.wf ? { wf: t.wf } : {}),
      ...(f & AttributeFlags.Hidden ? { invisible: true } : {}),
      ...(al && al !== (I.layer?.name ?? "") && ctx.layerNames.has(al) ? { layer: al } : {}),
      ...(ac !== undefined ? { color: ac } : {}),
    });
  }
  // kóta, kterou náš export do DXF zapsal jako blok (ARC_DIMENSION) – MNCAD JSON ji vrátí přesně
  const j = readXData(I).mncad?.json as { dim?: Partial<DDimension> } | undefined;
  if (j?.dim?.kind) return { type: "dimension", ...j.dim } as unknown as NewEntity;
  const multi = (I.columnCount ?? 1) > 1 || (I.rowCount ?? 1) > 1;
  return {
    type: "insert",
    block: decodeText(b.name),
    p: mx(v2(I.insertPoint), m),
    sx,
    sy: I.yScale || 1,
    rot,
    ...(attribs.length ? { attribs } : {}),
    ...(multi ? { cols: I.columnCount, rows: I.rowCount, colSpacing: I.columnSpacing, rowSpacing: I.rowSpacing } : {}),
  } as DInsert as unknown as NewEntity;
}

function viewportOf(V: Viewport): NewEntity {
  const st = Number(V.status ?? 0);
  const scale = V.viewHeight > 0 ? V.height / V.viewHeight : 1;
  const frozen = (V.frozenLayers ?? []).map((l) => decodeText(l.name));
  return {
    type: "viewport",
    c: v2(V.center),
    w: V.width,
    h: V.height,
    viewCenter: v2(V.viewCenter),
    scale,
    ...(V.twistAngle ? { twist: norm360(deg(V.twistAngle)) } : {}),
    ...(st & ViewportStatusFlags.ViewportZoomLocking ? { locked: true } : {}),
    ...(st & ViewportStatusFlags.ViewportOff ? { on: false } : {}),
    ...(frozen.length ? { frozenLayers: frozen } : {}),
  } as DViewport as unknown as NewEntity;
}

export type { DAttDef, XRec };

/**
 * PRC (ISO 14739-1, Product Representation Compact) — 3D obsah „3D PDF" z CAD systémů
 * (Creo, NX, SolidWorks/Tetra4D, CATIA, ZW3D, Asymptote/LaTeX…).
 *
 * Čteme hlavičku a souborové struktury, rozbalíme sekce (zlib), z globals barvy/materiály/styly,
 * ze stromu výskyty produktů, definice dílů a reprezentační položky, a z tessellace trojúhelníky
 * (TESS_3D i komprimovanou TESS_3D_Compressed) a dráty (TESS_3D_Wire). Přesná geometrie (B-rep)
 * se ignoruje. Výstupem jsou díly ve světových souřadnicích v mm a strom sestavy.
 *
 * Běží synchronně ve Web Workeru i v Node (vitest) — bez DOM a bez Node API.
 */

import { inflateSync, unzlibSync } from "fflate";
import { ModelImportError, type FaceRange, type MeshPart, type ModelNode, type ParsedModel, type Rgb } from "../types";
import { BitReader, PrcFormatError } from "./prc-bits";
import {
  mat4Identity,
  mat4IsIdentity,
  mat4Multiply,
  mat4Scale,
  type Mat4,
  type MeshTess,
  type PrcFileStructure,
  type PrcGlobals,
  type PrcModelFile,
  type PrcOccurrence,
  type PrcRI,
  type PrcTree,
  type Tess,
  type Uuid,
  type WireTess,
} from "./prc-model";
import { SectionReader, T } from "./prc-read";
import { readSchema, type PrcSchema } from "./prc-schema";

const FORMAT = "PRC (3D PDF)";
const ERR_PREFIX = "3D obsah (PRC) se nepodařilo přečíst";

const GR_SHOW = 0x0001;
const GR_FATHER_SHOW = 0x0004;
const GR_SON_COLOR = 0x0008;
const GR_FATHER_COLOR = 0x0010;
const GR_REMOVED = 0x2000;

// ---------------------------------------------------------------------------
// Veřejné API
// ---------------------------------------------------------------------------

export function parsePRC(data: Uint8Array): ParsedModel {
  if (!(data instanceof Uint8Array) || data.length < 64) {
    throw new ModelImportError(`${ERR_PREFIX}: soubor je prázdný nebo poškozený.`);
  }
  if (data[0] !== 0x50 || data[1] !== 0x52 || data[2] !== 0x43) {
    throw new ModelImportError(`${ERR_PREFIX}: nejde o data ve formátu PRC.`);
  }
  try {
    return readPrc(data);
  } catch (e) {
    if (e instanceof ModelImportError) throw e;
    if (e instanceof PrcFormatError) throw new ModelImportError(`${ERR_PREFIX}: ${e.message}.`);
    if (e instanceof RangeError) throw new ModelImportError(`${ERR_PREFIX}: model je příliš velký nebo poškozený.`);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Hlavička a sekce
// ---------------------------------------------------------------------------

interface HeaderFs {
  uuid: Uuid;
  offsets: number[];
}

interface Header {
  structures: HeaderFs[];
  modelStart: number;
  modelEnd: number;
}

function u32(d: Uint8Array, o: number): number {
  if (o + 4 > d.length) throw new PrcFormatError("hlavička je zkrácená");
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
}

function readHeader(d: Uint8Array): Header {
  let p = 3 + 4 + 4 + 16 + 16;
  const n = u32(d, p);
  p += 4;
  if (n === 0 || n > 100_000) throw new PrcFormatError("neplatný počet souborových struktur");
  const structures: HeaderFs[] = [];
  for (let i = 0; i < n; i++) {
    const uuid: Uuid = [u32(d, p), u32(d, p + 4), u32(d, p + 8), u32(d, p + 12)];
    p += 16 + 4; // + rezervováno
    const no = u32(d, p);
    p += 4;
    if (no > 64) throw new PrcFormatError("neplatná hlavička souborové struktury");
    const offsets: number[] = [];
    for (let k = 0; k < no; k++, p += 4) offsets.push(u32(d, p));
    structures.push({ uuid, offsets });
  }
  const modelStart = u32(d, p);
  const modelEnd = u32(d, p + 4);
  return { structures, modelStart, modelEnd };
}

/** Rozbalí zlib sekci od `start` do `end`; null = nejde rozbalit. */
function inflateSection(d: Uint8Array, start: number, end: number): Uint8Array | null {
  if (start <= 0 || start >= d.length) return null;
  const slice = d.subarray(start, Math.min(Math.max(end, start + 2), d.length));
  try {
    return unzlibSync(slice);
  } catch {
    try {
      return inflateSync(slice.subarray(2));
    } catch {
      return null;
    }
  }
}

function uuidEq(a: Uuid, b: Uuid): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

// ---------------------------------------------------------------------------
// Čtení celého souboru
// ---------------------------------------------------------------------------

function readPrc(data: Uint8Array): ParsedModel {
  const header = readHeader(data);
  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };

  // konce sekcí = nejbližší další začátek (offsety všech sekcí + modelu + konec dat)
  const bounds = new Set<number>([data.length, header.modelStart, header.modelEnd]);
  for (const s of header.structures) for (const o of s.offsets) bounds.add(o);
  const sortedBounds = [...bounds].sort((a, b) => a - b);
  const endOf = (start: number) => {
    for (const b of sortedBounds) if (b > start) return b;
    return data.length;
  };

  const structures: PrcFileStructure[] = [];
  for (const hs of header.structures) {
    structures.push(readStructure(data, hs, endOf, warn));
  }

  let model: PrcModelFile | null = null;
  const modelData = inflateSection(data, header.modelStart, header.modelEnd > header.modelStart ? header.modelEnd : endOf(header.modelStart));
  if (modelData) {
    try {
      model = readModelFile(modelData, structures.length);
    } catch (e) {
      if (!(e instanceof PrcFormatError)) throw e;
      model = null;
    }
  }

  return buildModel(structures, model, warn, warnings);
}

function readStructure(
  data: Uint8Array,
  hs: HeaderFs,
  endOf: (start: number) => number,
  warn: (msg: string) => void,
): PrcFileStructure {
  const fs: PrcFileStructure = {
    uuid: hs.uuid,
    version: 0,
    globals: { colors: [], materials: [], styles: [], coordSystems: [] },
    tree: null,
    tess: [],
    tessDeclared: 0,
    hasExactGeometry: false,
  };
  const off = hs.offsets;
  // hlavička souborové struktury (nekomprimovaná): „PRC", min. verze, verze autora
  if (off.length > 0 && off[0] + 11 <= data.length && data[off[0]] === 0x50 && data[off[0] + 1] === 0x52) {
    fs.version = u32(data, off[0] + 7);
  }
  if (!fs.version) fs.version = 8137;

  // sekce: [1] = globals (se schématem), další se poznají podle typu na začátku
  let schema: PrcSchema | null = null;
  let globalsData: Uint8Array | null = null;
  let treeData: Uint8Array | null = null;
  let tessData: Uint8Array | null = null;
  for (let i = 1; i < off.length; i++) {
    const sec = inflateSection(data, off[i], endOf(off[i]));
    if (!sec) continue;
    if (i === 1) {
      globalsData = sec;
      continue;
    }
    const type = peekType(sec);
    if (type === T.ASM_FileStructureTree) treeData = sec;
    else if (type === T.ASM_FileStructureTessellation) tessData = sec;
    else if (type === T.ASM_FileStructureGeometry) fs.hasExactGeometry = hasBodies(sec);
    else if (type === -1 && i === 2) treeData = sec;
    else if (type === -1 && i === 3) tessData = sec;
  }

  if (globalsData) {
    const S = new SectionReader(globalsData, fs.version, null);
    try {
      schema = readSchema(S.r);
      const S2 = new SectionReader(globalsData, fs.version, schema);
      S2.r.pos = S.r.pos;
      S2.globals(fs.globals);
    } catch (e) {
      if (!(e instanceof PrcFormatError)) throw e;
      if (fs.globals.styles.length === 0) warn("Barvy a styly z 3D PDF se nepodařilo celé načíst — model může mít výchozí barvu.");
    }
  }

  if (tessData) {
    const S = new SectionReader(tessData, fs.version, schema);
    try {
      const res = S.tessellations(warn);
      fs.tess = res.tess;
      fs.tessDeclared = res.declared;
      if (res.error) {
        warn("Část tessellace (trojúhelníků) v 3D PDF se nepodařilo přečíst — model může být neúplný.");
      }
    } catch (e) {
      if (!(e instanceof PrcFormatError)) throw e;
      warn("Tessellaci (trojúhelníky) v 3D PDF se nepodařilo přečíst.");
    }
  }

  if (treeData) {
    const S = new SectionReader(treeData, fs.version, schema);
    try {
      const res = S.treeTolerant();
      fs.tree = res.tree;
    } catch (e) {
      if (!(e instanceof PrcFormatError)) throw e;
      fs.tree = null;
    }
  }
  return fs;
}

function peekType(sec: Uint8Array): number {
  try {
    return new BitReader(sec).readUInt();
  } catch {
    return -1;
  }
}

/** Obsahuje sekce přesné geometrie nějaká tělesa? */
function hasBodies(sec: Uint8Array): boolean {
  try {
    const S = new SectionReader(sec, 8137, null);
    S.expect(T.ASM_FileStructureGeometry);
    S.base(false);
    return S.r.readUInt() > 0;
  } catch {
    return false;
  }
}

function readModelFile(sec: Uint8Array, nStructures: number): PrcModelFile {
  const S = new SectionReader(sec, 8137, null);
  const r = S.r;
  readSchema(r);
  S.expect(T.ASM_ModelFile);
  const name = S.base(false);
  const unitFromCad = r.readBool();
  const unit = r.readDouble();
  const n = S.count(100_000);
  const roots: { uuid: Uuid; index: number }[] = [];
  for (let i = 0; i < n; i++) {
    const uuid = S.uuid();
    const index = r.readUInt();
    r.readBool();
    roots.push({ uuid, index });
  }
  void nStructures;
  return { name, unit, unitFromCad, roots };
}

// ---------------------------------------------------------------------------
// Sestavení modelu
// ---------------------------------------------------------------------------

interface StyleCtx {
  style: number;
  fs: number;
  behaviour: number;
}

interface Builder {
  structures: PrcFileStructure[];
  parts: MeshPart[];
  warn: (msg: string) => void;
  usedTess: Set<string>;
  /** Respektovat příznak „skryto" (vypne se, když by se skrylo všechno). */
  honorHidden: boolean;
  hiddenSkipped: number;
  /** Jednotka (mm na jednotku souboru) platná pro celý model, nebo −1 = podle výskytů. */
  globalUnit: number;
}

function buildModel(
  structures: PrcFileStructure[],
  model: PrcModelFile | null,
  warn: (msg: string) => void,
  warnings: string[],
): ParsedModel {
  const unitValid = (u: number) => Number.isFinite(u) && u > 0;
  let globalUnit = -1;
  if (model && model.unitFromCad && unitValid(model.unit)) globalUnit = model.unit;

  const attempt = (honorHidden: boolean): { root: ModelNode; b: Builder } => {
    const b: Builder = {
      structures,
      parts: [],
      warn,
      usedTess: new Set(),
      honorHidden,
      hiddenSkipped: 0,
      globalUnit,
    };
    const root = buildTree(b, model);
    return { root, b };
  };

  let { root, b } = attempt(true);
  if (b.parts.length === 0 && b.hiddenSkipped > 0) ({ root, b } = attempt(false));

  // fallback: tessellace, na které strom neodkazuje (nebo strom chybí)
  const anyTree = structures.some((s) => s.tree && (s.tree.parts.length > 0 || s.tree.occurrences.length > 0));
  const partialTree = structures.some((s) => !s.tree || s.tree.partial);
  if (b.parts.length === 0 || partialTree) {
    const extra: ModelNode = { name: "Tessellace", parts: [], children: [] };
    structures.forEach((fs, fi) => {
      fs.tess.forEach((t, ti) => {
        if (!t || b.usedTess.has(`${fi}:${ti}`)) return;
        const unit = globalUnit > 0 ? globalUnit : firstValidUnit(fs) ?? (model && unitValid(model.unit) ? model.unit : 1);
        const idx = emitTess(b, t, mat4Scale(unit), `Těleso ${b.parts.length + 1}`, null, fs, []);
        if (idx >= 0) extra.parts.push(idx);
      });
    });
    if (extra.parts.length) {
      if (anyTree) warn("Strom sestavy v 3D PDF se nepodařilo přečíst celý — část dílů je zobrazena bez umístění.");
      else warn("Strom sestavy v 3D PDF chybí nebo je nečitelný — díly jsou zobrazeny bez umístění.");
      root.children.push(extra);
    }
  }

  if (b.parts.length === 0) {
    const declared = structures.reduce((s, fs) => s + fs.tessDeclared, 0);
    const exact = structures.some((fs) => fs.hasExactGeometry);
    if (declared === 0 && exact) {
      throw new ModelImportError(
        `${ERR_PREFIX}: model obsahuje jen přesnou geometrii (B-rep) bez tessellace, kterou prohlížeč zatím neumí zobrazit.`,
      );
    }
    if (declared > 0) {
      throw new ModelImportError(`${ERR_PREFIX}: trojúhelníkovou síť (tessellaci) modelu se nepodařilo rozbalit.`);
    }
    if (warnings.length) throw new ModelImportError(`${ERR_PREFIX}: ${warnings[0]}`);
    throw new ModelImportError(`${ERR_PREFIX}: model neobsahuje žádnou zobrazitelnou geometrii.`);
  }
  if (structures.some((fs) => fs.hasExactGeometry && fs.tessDeclared === 0)) {
    warn("Část modelu je uložena jen jako přesná geometrie (B-rep) bez tessellace a nezobrazí se.");
  }

  const out: ParsedModel = { parts: b.parts, root, format: FORMAT };
  if (warnings.length) out.warnings = warnings;
  return out;
}

function firstValidUnit(fs: PrcFileStructure): number | null {
  for (const po of fs.tree?.occurrences ?? []) if (po.unitFromCad && po.unit > 0) return po.unit;
  return null;
}

function findStructure(structures: PrcFileStructure[], uuid: Uuid): number {
  return structures.findIndex((s) => uuidEq(s.uuid, uuid));
}

/** Kořenové výskyty: z modelového souboru, jinak z interních dat struktur, jinak odhad. */
function rootRefs(b: Builder, model: PrcModelFile | null): { fs: number; po: number }[] {
  const out: { fs: number; po: number }[] = [];
  const S = b.structures;
  if (model) {
    for (const r of model.roots) {
      const fi = findStructure(S, r.uuid);
      if (fi < 0) continue;
      const tree = S[fi].tree;
      if (!tree) continue;
      const n = tree.occurrences.length;
      let po = -1;
      if (r.index >= 1 && r.index <= n) po = r.index - 1;
      else if (r.index === 0 && n > 0) po = 0;
      if (po >= 0) out.push({ fs: fi, po });
    }
    if (out.length) return out;
  }
  // bez modelového souboru: poslední struktura obsahuje kořen sestavy
  for (let fi = S.length - 1; fi >= 0; fi--) {
    const tree = S[fi].tree;
    if (!tree || tree.occurrences.length === 0) continue;
    const n = tree.occurrences.length;
    if (tree.root >= 0 && tree.root < n) out.push({ fs: fi, po: tree.root });
    else if (tree.root === n) out.push({ fs: fi, po: n - 1 });
    else {
      // výskyty, na které nikdo neodkazuje
      const referenced = new Set<number>();
      for (const po of tree.occurrences) {
        for (const s of po.sons) referenced.add(s);
        if (po.prototype >= 0 && !po.prototypeFs) referenced.add(po.prototype);
        if (po.external >= 0 && !po.externalFs) referenced.add(po.external);
      }
      for (let i = 0; i < n; i++) if (!referenced.has(i)) out.push({ fs: fi, po: i });
    }
    break;
  }
  return out;
}

function buildTree(b: Builder, model: PrcModelFile | null): ModelNode {
  const roots = rootRefs(b, model);
  const rootNode: ModelNode = { name: model?.name && model.name !== "PRC file" ? model.name : "Model", parts: [], children: [] };
  for (const r of roots) {
    const fs = b.structures[r.fs];
    const unit = b.globalUnit > 0 ? b.globalUnit : rootUnit(b, r.fs, r.po);
    const node = visitOccurrence(b, r.fs, r.po, mat4Scale(unit), unit, [], new Set(), 0);
    if (node) rootNode.children.push(node);
    void fs;
  }
  // jediný kořen bez dílů → zjednodušit
  if (rootNode.children.length === 1 && rootNode.parts.length === 0) {
    const only = rootNode.children[0];
    return { name: only.name || rootNode.name, parts: only.parts, children: only.children };
  }
  return rootNode;
}

/** Jednotka pro kořen: první platná jednotka v podstromu (podle specifikace platí pro celou hierarchii). */
function rootUnit(b: Builder, fi: number, pi: number): number {
  const seen = new Set<string>();
  const stack: [number, number][] = [[fi, pi]];
  let fallback = -1;
  while (stack.length) {
    const [f, p] = stack.pop()!;
    const key = `${f}:${p}`;
    if (seen.has(key) || seen.size > 10_000) continue;
    seen.add(key);
    const po = b.structures[f]?.tree?.occurrences[p];
    if (!po) continue;
    if (po.unitFromCad && po.unit > 0) return po.unit;
    if (fallback < 0 && po.unit > 0) fallback = po.unit;
    for (const s of po.sons) stack.push([f, s]);
    if (po.prototype >= 0) {
      const pf = po.prototypeFs ? findStructure(b.structures, po.prototypeFs) : f;
      if (pf >= 0) stack.push([pf, po.prototype]);
    }
    if (po.external >= 0) {
      const ef = po.externalFs ? findStructure(b.structures, po.externalFs) : f;
      if (ef >= 0) stack.push([ef, po.external]);
    }
  }
  return fallback > 0 ? fallback : 1;
}

function isHidden(behaviour: number): boolean {
  return (behaviour & GR_REMOVED) !== 0 || (behaviour & GR_SHOW) === 0;
}

/** Dědičnost barvy: syn přebíjí otce, pokud otec nevynucuje svou (FatherHeritColor). */
function inheritStyle(parent: StyleCtx[], style: number, behaviour: number, fs: number): StyleCtx[] {
  if (style < 0) return parent;
  const top = parent.length ? parent[parent.length - 1] : null;
  if (top && top.behaviour & GR_FATHER_COLOR && !(behaviour & GR_SON_COLOR)) return parent;
  return [...parent, { style, fs, behaviour }];
}

function visitOccurrence(
  b: Builder,
  fi: number,
  pi: number,
  parentMatrix: Mat4,
  parentUnit: number,
  styles: StyleCtx[],
  path: Set<string>,
  depth: number,
): ModelNode | null {
  const fs = b.structures[fi];
  const po = fs?.tree?.occurrences[pi];
  if (!po) return null;
  const key = `${fi}:${pi}`;
  if (path.has(key) || depth > 64) return null;
  const nextPath = new Set(path);
  nextPath.add(key);

  if (b.honorHidden && isHidden(po.graphics.behaviour) && !(po.graphics.behaviour & GR_FATHER_SHOW)) {
    b.hiddenSkipped++;
    return null;
  }

  // řetěz prototypů: první definovaná poloha, díl a synové
  const chain: { f: number; p: PrcOccurrence }[] = [{ f: fi, p: po }];
  {
    let cf = fi;
    let cp: PrcOccurrence = po;
    const seen = new Set<string>([key]);
    while (cp.prototype >= 0) {
      const nf = cp.prototypeFs ? findStructure(b.structures, cp.prototypeFs) : cf;
      if (nf < 0) break;
      const np = b.structures[nf].tree?.occurrences[cp.prototype];
      const k2 = `${nf}:${cp.prototype}`;
      if (!np || seen.has(k2)) break;
      seen.add(k2);
      chain.push({ f: nf, p: np });
      cf = nf;
      cp = np;
    }
  }
  const location = chain.find((c) => c.p.location)?.p.location ?? null;
  const partOwner = chain.find((c) => c.p.part >= 0) ?? null;
  const sonsOwner = chain.find((c) => c.p.sons.length > 0) ?? null;

  // jednotka výskytu (jen když model nemá jednotku globálně)
  let unit = parentUnit;
  let matrix = location ? mat4Multiply(parentMatrix, location) : parentMatrix;
  if (b.globalUnit < 0) {
    const own = chain.find((c) => c.p.unitFromCad && c.p.unit > 0)?.p.unit;
    if (own && Math.abs(own - parentUnit) > 1e-12 * own) {
      matrix = mat4Multiply(matrix, mat4Scale(own / parentUnit));
      unit = own;
    }
  }

  let st = styles;
  for (let i = chain.length - 1; i >= 0; i--) st = inheritStyle(st, chain[i].p.graphics.style, chain[i].p.graphics.behaviour, chain[i].f);

  const name = po.name || chain.find((c) => c.p.name)?.p.name || "";
  const node: ModelNode = { name, parts: [], children: [] };

  if (partOwner) {
    const pfs = b.structures[partOwner.f];
    const part = pfs.tree?.parts[partOwner.p.part];
    if (part) {
      if (!node.name) node.name = part.name;
      const pst = inheritStyle(st, part.graphics.style, part.graphics.behaviour, partOwner.f);
      if (!(b.honorHidden && isHidden(part.graphics.behaviour) && part.graphics.behaviour !== 0)) {
        for (const ri of part.items) emitItem(b, partOwner.f, ri, matrix, pst, node, part.name || node.name, 0);
      } else b.hiddenSkipped++;
    }
  }

  if (sonsOwner) {
    for (const s of sonsOwner.p.sons) {
      const child = visitOccurrence(b, sonsOwner.f, s, matrix, unit, st, nextPath, depth + 1);
      if (child && (child.parts.length || child.children.length)) node.children.push(child);
    }
  }

  // externí data (jiná souborová struktura) — samostatný podstrom
  for (const c of chain) {
    if (c.p.external < 0) continue;
    const ef = c.p.externalFs ? findStructure(b.structures, c.p.externalFs) : c.f;
    if (ef < 0) continue;
    const child = visitOccurrence(b, ef, c.p.external, matrix, unit, st, nextPath, depth + 1);
    if (child && (child.parts.length || child.children.length)) {
      if (!child.name) child.name = name;
      node.children.push(child);
    }
    break;
  }

  if (!node.name) node.name = node.children.length ? "Sestava" : "Díl";
  return node;
}

function emitItem(
  b: Builder,
  fi: number,
  ri: PrcRI,
  matrix: Mat4,
  styles: StyleCtx[],
  node: ModelNode,
  fallbackName: string,
  depth: number,
): void {
  if (depth > 64) return;
  if (b.honorHidden && isHidden(ri.graphics.behaviour) && !(ri.graphics.behaviour & GR_FATHER_SHOW)) {
    b.hiddenSkipped++;
    return;
  }
  const fs = b.structures[fi];
  let m = matrix;
  if (ri.localCs >= 0) {
    const cs = fs.globals.coordSystems[ri.localCs];
    if (cs) m = mat4Multiply(matrix, cs);
  }
  const st = inheritStyle(styles, ri.graphics.style, ri.graphics.behaviour, fi);
  if (ri.children) {
    for (const c of ri.children) emitItem(b, fi, c, m, st, node, ri.name || fallbackName, depth + 1);
    return;
  }
  if (ri.tess < 0) return;
  const t = fs.tess[ri.tess];
  if (!t) return;
  if (ri.type === T.RI_BrepModel || ri.type === T.RI_PolyBrepModel || ri.type === T.RI_Curve || ri.type === T.RI_PolyWire) {
    // ok
  } else if (t.kind !== "mesh" && t.kind !== "wire") return;
  b.usedTess.add(`${fi}:${ri.tess}`);
  const name = ri.name || fallbackName || `Díl ${b.parts.length + 1}`;
  const idx = emitTess(b, t, m, name, st.length ? st[st.length - 1] : null, fs, st);
  if (idx >= 0) node.parts.push(idx);
}

// ---------------------------------------------------------------------------
// Barvy
// ---------------------------------------------------------------------------

function resolveStyle(g: PrcGlobals, styleIndex: number): { color: Rgb | null; opacity: number } {
  const st = g.styles[styleIndex];
  if (!st) return { color: null, opacity: 1 };
  let color: Rgb | null = null;
  let opacity = st.transparency >= 0 ? st.transparency / 255 : 1;
  // index barvy ukazuje na složku R v poli doublů (tj. je to 3 × pořadí barvy)
  const col = (i: number): Rgb | null =>
    i >= 0 && i + 2 < g.colors.length ? [clamp01(g.colors[i]), clamp01(g.colors[i + 1]), clamp01(g.colors[i + 2])] : null;
  if (st.isMaterial) {
    let mat = g.materials[st.index];
    let guard = 0;
    while (mat && mat.kind === 1 && guard++ < 8) mat = g.materials[mat.generic];
    if (mat && mat.kind === 0) {
      color = col(mat.diffuse) ?? col(mat.ambient) ?? col(mat.emissive);
      if (st.transparency < 0 && mat.diffuseAlpha >= 0 && mat.diffuseAlpha < 1) opacity = mat.diffuseAlpha;
    }
  } else color = col(st.index);
  return { color, opacity: clamp01(opacity) };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Převod tessellace na MeshPart (světové souřadnice v mm)
// ---------------------------------------------------------------------------

function emitTess(
  b: Builder,
  t: Tess,
  m: Mat4,
  name: string,
  style: StyleCtx | null,
  fs: PrcFileStructure,
  _styles: StyleCtx[],
): number {
  void _styles;
  let color: Rgb | null = null;
  let opacity = 1;
  if (style) {
    const res = resolveStyle(b.structures[style.fs]?.globals ?? fs.globals, style.style);
    color = res.color;
    opacity = res.opacity;
  }
  const part = t.kind === "mesh" ? meshPart(t, m, name, fs.globals) : wirePart(t, m, name);
  if (!part) return -1;
  if (color) part.color = color;
  else if (part.faces && part.faces.length && part.faces.every((f) => f.color && sameColor(f.color, part.faces![0].color!))) {
    part.color = part.faces[0].color!;
  }
  if (opacity < 1) part.opacity = opacity;
  // barvy ploch shodné s barvou dílu nemá smysl držet
  if (part.faces && part.color) {
    for (const f of part.faces) if (f.color && sameColor(f.color, part.color)) f.color = null;
  }
  b.parts.push(part);
  return b.parts.length - 1;
}

function sameColor(a: Rgb, b: Rgb): boolean {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-4;
}

function wirePart(t: WireTess, m: Mat4, name: string): MeshPart | null {
  if (t.seg.length === 0) return null;
  const lines = new Float32Array(t.seg.length * 3);
  const p = t.pos;
  for (let i = 0; i < t.seg.length; i++) {
    const v = t.seg[i] * 3;
    const x = p[v],
      y = p[v + 1],
      z = p[v + 2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    lines[i * 3] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    lines[i * 3 + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    lines[i * 3 + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  }
  return { name, positions: new Float32Array(0), indices: new Uint32Array(0), lines };
}

/**
 * Trojúhelníky po plochách → indexovaná síť s vrcholy rozdělenými po plochách (plochy tak mají
 * vlastní normály i barvy a hranice ploch zůstanou zachované). Normály: ze souboru, jinak
 * vyhlazené v rámci plochy s ohledem na úhel zlomu (crease angle).
 */
function meshPart(t: MeshTess, m: Mat4, name: string, g: PrcGlobals): MeshPart | null {
  const nTri = t.tri.length / 3;
  if (nTri === 0) return null;
  const nSrc = Math.floor(t.pos.length / 3);
  const src = t.pos;
  const tri = t.tri;
  const cn = t.cornerNormals;

  // matice normál = kofaktory 3×3 (směr inverzní transpozice); zrcadlení obrací pořadí vrcholů
  const a00 = m[0],
    a01 = m[4],
    a02 = m[8],
    a10 = m[1],
    a11 = m[5],
    a12 = m[9],
    a20 = m[2],
    a21 = m[6],
    a22 = m[10];
  const c00 = a11 * a22 - a12 * a21,
    c01 = a12 * a20 - a10 * a22,
    c02 = a10 * a21 - a11 * a20;
  const c10 = a02 * a21 - a01 * a22,
    c11 = a00 * a22 - a02 * a20,
    c12 = a01 * a20 - a00 * a21;
  const c20 = a01 * a12 - a02 * a11,
    c21 = a02 * a10 - a00 * a12,
    c22 = a00 * a11 - a01 * a10;
  const det = a00 * c00 + a01 * c01 + a02 * c02;
  const flip = det < 0;
  const sg = flip ? -1 : 1;
  const identity = mat4IsIdentity(m);
  const projective = m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1;

  // normály trojúhelníků (lokálně, neváhované délkou = 2× plocha)
  let triN: Float64Array | null = null;
  if (!cn) {
    triN = new Float64Array(nTri * 3);
    for (let k = 0; k < nTri; k++) {
      const i0 = tri[k * 3] * 3,
        i1 = tri[k * 3 + 1] * 3,
        i2 = tri[k * 3 + 2] * 3;
      const ux = src[i1] - src[i0],
        uy = src[i1 + 1] - src[i0 + 1],
        uz = src[i1 + 2] - src[i0 + 2];
      const vx = src[i2] - src[i0],
        vy = src[i2 + 1] - src[i0 + 1],
        vz = src[i2 + 2] - src[i0 + 2];
      triN[k * 3] = uy * vz - uz * vy;
      triN[k * 3 + 1] = uz * vx - ux * vz;
      triN[k * 3 + 2] = ux * vy - uy * vx;
    }
  }
  const cosCrease = Math.cos(t.creaseAngle);

  // výstup (rozšiřuje se podle potřeby)
  let cap = Math.max(64, Math.min(nTri * 3, Math.ceil(nSrc * 1.5) + 64));
  let outPos = new Float32Array(cap * 3);
  let outNrm = new Float32Array(cap * 3);
  let next = new Int32Array(cap);
  let outCount = 0;
  const indices = new Uint32Array(nTri * 3);
  const faces: FaceRange[] = [];

  // mapování zdrojového vrcholu na první výstupní vrchol v aktuální ploše
  const remap = new Int32Array(nSrc).fill(-1);
  const touched: number[] = [];
  // pro dopočet normál: rohy vrcholu v rámci plochy (CSR)
  const slotOf = cn ? null : new Int32Array(nSrc).fill(-1);
  let cornerOff = new Int32Array(64);
  let cornerList = new Int32Array(64);

  const addVertex = (v: number, nx: number, ny: number, nz: number): number => {
    let wx = nx,
      wy = ny,
      wz = nz;
    if (!identity) {
      wx = sg * (c00 * nx + c01 * ny + c02 * nz);
      wy = sg * (c10 * nx + c11 * ny + c12 * nz);
      wz = sg * (c20 * nx + c21 * ny + c22 * nz);
    }
    const l = Math.hypot(wx, wy, wz);
    if (l > 0) {
      wx /= l;
      wy /= l;
      wz /= l;
    }
    let o = remap[v];
    let last = -1;
    while (o >= 0) {
      if (
        Math.abs(outNrm[o * 3] - wx) < 1e-3 &&
        Math.abs(outNrm[o * 3 + 1] - wy) < 1e-3 &&
        Math.abs(outNrm[o * 3 + 2] - wz) < 1e-3
      ) {
        return o;
      }
      last = o;
      o = next[o];
    }
    if (outCount >= cap) {
      cap *= 2;
      const p2 = new Float32Array(cap * 3);
      p2.set(outPos);
      outPos = p2;
      const n2 = new Float32Array(cap * 3);
      n2.set(outNrm);
      outNrm = n2;
      const x2 = new Int32Array(cap);
      x2.set(next);
      next = x2;
    }
    const id = outCount++;
    const x = src[v * 3],
      y = src[v * 3 + 1],
      z = src[v * 3 + 2];
    if (identity) {
      outPos[id * 3] = x;
      outPos[id * 3 + 1] = y;
      outPos[id * 3 + 2] = z;
    } else {
      const w = projective ? m[3] * x + m[7] * y + m[11] * z + m[15] || 1 : 1;
      outPos[id * 3] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
      outPos[id * 3 + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
      outPos[id * 3 + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    }
    outNrm[id * 3] = wx;
    outNrm[id * 3 + 1] = wy;
    outNrm[id * 3 + 2] = wz;
    next[id] = -1;
    if (last >= 0) next[last] = id;
    else {
      remap[v] = id;
      touched.push(v);
    }
    return id;
  };

  let triOut = 0;
  const nFaces = t.faceStart.length - 1;
  for (let f = 0; f < nFaces; f++) {
    const t0 = t.faceStart[f],
      t1 = t.faceStart[f + 1];
    if (t1 <= t0) continue;
    const firstTri = triOut;

    if (slotOf && triN) {
      // CSR rohů: pro každý vrchol plochy seznam rohů (k*3 + c)
      const verts: number[] = [];
      for (let k = t0; k < t1; k++) {
        for (let c = 0; c < 3; c++) {
          const v = tri[k * 3 + c];
          if (slotOf[v] < 0) {
            slotOf[v] = verts.length;
            verts.push(v);
          }
        }
      }
      const nv = verts.length;
      if (cornerOff.length < nv + 1) cornerOff = new Int32Array((nv + 1) * 2);
      cornerOff.fill(0, 0, nv + 1);
      for (let k = t0; k < t1; k++) for (let c = 0; c < 3; c++) cornerOff[slotOf[tri[k * 3 + c]] + 1]++;
      for (let i = 0; i < nv; i++) cornerOff[i + 1] += cornerOff[i];
      const nc = (t1 - t0) * 3;
      if (cornerList.length < nc) cornerList = new Int32Array(nc * 2);
      const fillPos = cornerOff.slice(0, nv);
      for (let k = t0; k < t1; k++) {
        for (let c = 0; c < 3; c++) {
          const s = slotOf[tri[k * 3 + c]];
          cornerList[fillPos[s]++] = k;
        }
      }
      for (let k = t0; k < t1; k++) {
        const ax = triN[k * 3],
          ay = triN[k * 3 + 1],
          az = triN[k * 3 + 2];
        const al = Math.hypot(ax, ay, az);
        for (let cc = 0; cc < 3; cc++) {
          const c = flip && cc > 0 ? 3 - cc : cc;
          const v = tri[k * 3 + c];
          const s = slotOf[v];
          let nx = 0,
            ny = 0,
            nz = 0;
          for (let q = cornerOff[s]; q < cornerOff[s + 1]; q++) {
            const k2 = cornerList[q];
            const bx = triN[k2 * 3],
              by = triN[k2 * 3 + 1],
              bz = triN[k2 * 3 + 2];
            if (k2 !== k) {
              const bl = Math.hypot(bx, by, bz);
              if (!(al > 0 && bl > 0) || (ax * bx + ay * by + az * bz) < cosCrease * al * bl) continue;
            }
            nx += bx;
            ny += by;
            nz += bz;
          }
          if (nx === 0 && ny === 0 && nz === 0) {
            nx = ax;
            ny = ay;
            nz = az;
          }
          indices[triOut * 3 + cc] = addVertex(v, nx, ny, nz);
        }
        triOut++;
      }
      for (const v of verts) slotOf[v] = -1;
    } else {
      for (let k = t0; k < t1; k++) {
        for (let cc = 0; cc < 3; cc++) {
          const c = flip && cc > 0 ? 3 - cc : cc;
          const q = (k * 3 + c) * 3;
          indices[triOut * 3 + cc] = addVertex(tri[k * 3 + c], cn![q], cn![q + 1], cn![q + 2]);
        }
        triOut++;
      }
    }
    for (const v of touched) remap[v] = -1;
    touched.length = 0;
    const fsIdx = t.faceStyle[f];
    faces.push({ first: firstTri, last: triOut - 1, color: fsIdx >= 0 ? resolveStyle(g, fsIdx).color : null });
  }

  return {
    name,
    positions: outPos.slice(0, outCount * 3),
    normals: outNrm.slice(0, outCount * 3),
    indices,
    faces,
  };
}

// re-export pro testy / ladění
export { mat4Identity };
export type { PrcTree };
